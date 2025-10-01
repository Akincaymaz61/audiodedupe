import type { DuplicateGroup } from './types';

// Levenshtein distance calculation
function calculateLevenshtein(a: string, b: string): number {
    const an = a ? a.length : 0;
    const bn = b ? b.length : 0;
    if (an === 0) return bn;
    if (bn === 0) return an;
    const matrix = new Array<number[]>(bn + 1);
    for (let i = 0; i <= bn; ++i) {
        let row = matrix[i] = new Array<number>(an + 1);
        row[0] = i;
    }
    const firstRow = matrix[0];
    for (let j = 1; j <= an; ++j) {
        firstRow[j] = j;
    }
    for (let i = 1; i <= bn; ++i) {
        for (let j = 1; j <= an; ++j) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[bn][an];
}

function calculateSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) {
        return 1.0;
    }
    const distance = calculateLevenshtein(longer, shorter);
    return (longer.length - distance) / longer.length;
}


const VERSION_MARKERS = [
    'remix', 'live', 'acoustic', 'instrumental', 'radio edit', 
    'reprise', 'bonus', 'demo', 'alternate version', 'unplugged',
    'rehearsal', 'soundcheck', 'extended', 'club mix'
];

/**
 * Normalizes a file name based on the user's specific format:
 * [Camelot] - [BPM] - [Artist] - [Title]
 * @param filePath The full path of the file.
 * @returns A normalized string containing only the artist and title.
 */
function normalizeFileName(filePath: string): string {
    let name = (filePath.split('/').pop() || '').toLowerCase();
    
    // 1. Remove file extension
    name = name.substring(0, name.lastIndexOf('.')) || name;
    
    // 2. Remove _PN (Platinum Notes) suffix
    name = name.replace(/_pn$/, '').trim();

    // 3. Split by ' - '
    const parts = name.split(' - ');

    let artistAndTitle: string;

    // If there are 4 or more parts, assume [Camelot] - [BPM] - [Artist] - [Title]
    if (parts.length >= 4) {
        // Combine artist (3rd part) and title (4th part onwards)
        artistAndTitle = parts.slice(2).join(' ').trim();
    } else {
        // Fallback for names that don't fit the pattern
        // Remove Camelot notation (e.g., 1a, 11b) and BPM at the start
        const fallbackName = name.replace(/^\d{1,2}[ab]\s*-\s*\d{2,3}\s*-\s*/, '');
        artistAndTitle = fallbackName;
    }

    // Remove version markers like (remix), [live] etc.
    // This helps group different versions of the same song together
    let finalName = artistAndTitle.replace(/[\[(](.*?)[\])]/g, (match, content) => {
        const potentialVersion = content.toLowerCase().trim();
        if (VERSION_MARKERS.some(marker => potentialVersion.includes(marker))) {
            return ''; // Remove version marker from name
        }
        return match; // Keep it if it's not a version marker
    }).trim();

    // Finally, remove remaining special characters and extra spaces
    finalName = finalName.replace(/[^\w\s\d]/gi, ' ').replace(/\s+/g, ' ').trim();
    
    return finalName;
}


/**
 * Finds duplicate audio files in a given list of file paths based on file name similarity.
 * This function runs entirely on the client-side and is optimized for performance.
 * @param filePaths An array of file paths.
 * @param similarityThreshold The minimum similarity score to consider files as duplicates.
 * @returns An array of duplicate groups.
 */
export function findDuplicateGroupsLocally(filePaths: string[], similarityThreshold = 0.85): DuplicateGroup[] {
    if (filePaths.length < 2) return [];

    const filesWithNormalizedNames = filePaths.map(path => ({
        path,
        normalized: normalizeFileName(path)
    }));

    const groups: Map<string, string[]> = new Map();
    const checkedPaths = new Set<string>();

    for (let i = 0; i < filesWithNormalizedNames.length; i++) {
        const fileA = filesWithNormalizedNames[i];
        if (checkedPaths.has(fileA.path) || !fileA.normalized) {
            continue;
        }

        let bestMatchKey: string | null = null;
        let maxSimilarity = 0;
        let bestGroup: string[] | null = null;

        // Try to find an existing group to join
        for (const [key, existingGroup] of groups.entries()) {
            const representativePath = existingGroup[0];
            const representativeNormalized = filesWithNormalizedNames.find(f=>f.path === representativePath)!.normalized;
            const similarity = calculateSimilarity(fileA.normalized, representativeNormalized);
            
            if (similarity > similarityThreshold && similarity > maxSimilarity) {
                maxSimilarity = similarity;
                bestMatchKey = key;
                bestGroup = existingGroup;
            }
        }
        
        // If a suitable group is found, add the file to it
        if (bestGroup && bestMatchKey) {
            bestGroup.push(fileA.path);
            checkedPaths.add(fileA.path);
        } else {
            // Otherwise, start a new group with the current file as the representative
            const newGroup = [fileA.path];
            checkedPaths.add(fileA.path);

            for (let j = i + 1; j < filesWithNormalizedNames.length; j++) {
                const fileB = filesWithNormalizedNames[j];
                if (checkedPaths.has(fileB.path) || !fileB.normalized) {
                    continue;
                }
                
                const similarity = calculateSimilarity(fileA.normalized, fileB.normalized);

                if (similarity >= similarityThreshold) {
                    newGroup.push(fileB.path);
                    checkedPaths.add(fileB.path);
                     if (similarity > maxSimilarity) {
                        maxSimilarity = similarity;
                    }
                }
            }

            if (newGroup.length > 1) {
                groups.set(fileA.path, newGroup);
            }
        }
    }

    return Array.from(groups.entries()).map(([key, files]) => {
        const normalizedKey = filesWithNormalizedNames.find(f=>f.path === key)!.normalized;
        
        let maxSim = 0;
        if (files.length > 1) {
            const sim = calculateSimilarity(
                filesWithNormalizedNames.find(f => f.path === files[0])!.normalized,
                filesWithNormalizedNames.find(f => f.path === files[1])!.normalized
            );
            maxSim = sim;
        }

        return {
            files: files.sort(),
            reason: `Dosya adları "${normalizedKey}" adına benziyor.`,
            similarityScore: maxSim,
        };
    }).filter(group => group.files.length > 1);
}