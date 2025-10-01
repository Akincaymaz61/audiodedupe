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
    'rehearsal', 'soundcheck', 'extended', 'club mix', 'original mix',
    'edit', 'version', 'dub'
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

    // If there are 3 or more parts, assume a structure like [KEY] - [ARTIST] - [TITLE] or [KEY] - [BPM] - [ARTIST] - [TITLE]
    if (parts.length >= 3) {
         // Check if the first part is a Camelot key (e.g., "1a", "10b")
        const isCamelot = /^\d{1,2}[ab]$/.test(parts[0].trim());
        // Check if the second part looks like BPM (e.g., "124")
        const isBpm = /^\d{2,3}$/.test(parts[1].trim());

        if (isCamelot && isBpm && parts.length >= 4) {
             // Format: [KEY] - [BPM] - [ARTIST] - [TITLE]
            artistAndTitle = parts.slice(2).join(' ');
        } else if (isCamelot) {
            // Format: [KEY] - [ARTIST] - [TITLE]
            artistAndTitle = parts.slice(1).join(' ');
        }
        else {
            // Not a recognized pattern, use the whole name
            artistAndTitle = parts.join(' ');
        }
    } else {
        // Fallback for names that don't fit the pattern (e.g., "Artist - Title")
        artistAndTitle = name;
    }

    // Remove version markers like (remix), [live] etc.
    let finalName = artistAndTitle.replace(/[\[(](.*?)[\])]/g, (match, content) => {
        const potentialVersion = content.toLowerCase().trim();
        if (VERSION_MARKERS.some(marker => potentialVersion.includes(marker))) {
            return ''; // Remove version marker from name
        }
        return match; // Keep it if it's not a version marker
    }).trim();
    
    // Also remove version markers that are not in parentheses
    for (const marker of VERSION_MARKERS) {
        // Match marker with word boundaries to avoid replacing parts of words
        const regex = new RegExp(`\\b${marker}\\b`, 'gi');
        finalName = finalName.replace(regex, '');
    }


    // Finally, remove remaining special characters and extra spaces
    finalName = finalName.replace(/[^\w\s\d]/gi, ' ').replace(/\s+/g, ' ').trim();
    
    // After all removals, if the name ends with just a number (likely a track number), remove it.
    finalName = finalName.replace(/-\s*\d{1,3}\s*$/, '').trim();
    finalName = finalName.replace(/\s+\d{1,3}$/, '').trim();


    return finalName;
}


/**
 * Finds duplicate audio files in a given list of file paths based on file name similarity.
 * This function runs entirely on the client-side.
 * @param filePaths An array of file paths to check for duplicates.
 * @param similarityThreshold The minimum similarity score to consider files as duplicates.
 * @param existingPaths An optional array of paths that have already been processed to check against.
 * @returns An array of duplicate groups found within the `filePaths` chunk.
 */
export function findDuplicateGroupsLocally(
    filePaths: string[], 
    similarityThreshold = 0.85, 
    existingPaths: string[] = []
): DuplicateGroup[] {
    if (filePaths.length === 0) return [];

    const allPaths = [...existingPaths, ...filePaths];
    
    const filesWithNormalizedNames = allPaths.map(path => ({
        path,
        normalized: normalizeFileName(path)
    }));
    
    const normalizedMap: Map<string, {path: string, normalized: string}> = new Map();
    filesWithNormalizedNames.forEach(f => normalizedMap.set(f.path, f));

    const groups: Map<string, string[]> = new Map();
    const checkedPaths = new Set<string>();

    // Only iterate through the new chunk of files
    const chunkFilePaths = new Set(filePaths);

    for (let i = 0; i < allPaths.length; i++) {
        const fileA = normalizedMap.get(allPaths[i])!;
        
        // Only start a new group search for files in the current chunk
        if (!chunkFilePaths.has(fileA.path)) {
            continue;
        }

        if (checkedPaths.has(fileA.path) || !fileA.normalized) {
            continue;
        }

        const newGroup = [fileA.path];
        let maxSimilarity = 0;

        for (let j = i + 1; j < allPaths.length; j++) {
            const fileB = normalizedMap.get(allPaths[j])!;
            if (checkedPaths.has(fileB.path) || !fileB.normalized) {
                continue;
            }
            
            const similarity = calculateSimilarity(fileA.normalized, fileB.normalized);

            if (similarity >= similarityThreshold) {
                newGroup.push(fileB.path);
                // Mark B as checked so it doesn't start its own group search.
                // This is important for performance.
                checkedPaths.add(fileB.path);
                 if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                }
            }
        }

        if (newGroup.length > 1) {
            // Mark A as checked since it's now part of a group.
            checkedPaths.add(fileA.path);
            groups.set(fileA.path, newGroup);
        }
    }

    return Array.from(groups.values()).map((files) => {
        const firstFileNormalized = normalizedMap.get(files[0])?.normalized || 'yok';
        
        let score = 0;
        if (files.length > 1) {
            const secondFileNormalized = normalizedMap.get(files[1])?.normalized || 'yok';
            score = calculateSimilarity(firstFileNormalized, secondFileNormalized);
        }

        return {
            files: files.sort(),
            reason: `Dosya adları "${firstFileNormalized}" adına benziyor.`,
            similarityScore: score,
        };
    }).filter(group => group.files.length > 1);
}
