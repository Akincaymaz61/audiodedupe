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
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    if (longer.length === 0) {
        return 1.0;
    }
    const distance = calculateLevenshtein(longer, shorter);
    return (longer.length - distance) / longer.length;
}


const VERSION_MARKERS = [
    '(remix)', '[remix]',
    '(live)', '[live]',
    '(acoustic)', '[acoustic]',
    '(instrumental)', '[instrumental]',
    '(radio edit)', '[radio edit]',
    '- remix', '- live', '- acoustic', '- instrumental', '- radio edit'
];

function normalizeFileName(filePath: string): string {
    let name = (filePath.split('/').pop() || '').toLowerCase();
    // Remove extension
    name = name.substring(0, name.lastIndexOf('.')) || name;
    // Remove common duplicate markers
    name = name.replace(/\(\d+\)$/, '').trim(); // (1), (2)
    name = name.replace(/\[\d+\]$/, '').trim(); // [1], [2]
    name = name.replace(/-\s*\d+$/, '').trim(); // - 1, -2
    name = name.replace(/-\s*copy\s*\d*$/, '').trim(); // - copy, - copy 2
    name = name.replace(/-\s*kopya\s*\d*$/, '').trim(); // - kopya, - kopya 2
    name = name.replace(/\(copy\)$/, '').trim(); // (copy)
    name = name.replace(/\(kopya\)$/, '').trim(); // (kopya)
    
    // Temporarily remove version markers for base comparison
    let baseName = name;
    for (const marker of VERSION_MARKERS) {
        baseName = baseName.replace(marker, '').trim();
    }
    
    // Remove special characters from the base name
    baseName = baseName.replace(/[^\w\s]/gi, '').trim();
    
    // Add back a simplified version marker if one was present
    for (const marker of VERSION_MARKERS) {
        if (name.includes(marker)) {
            const simplifiedMarker = marker.replace(/[\(\)\[\]-]/g, '').trim().split(' ')[0];
             // Return base name + simplified marker to distinguish versions
            return `${baseName} ${simplifiedMarker}`;
        }
    }

    return baseName;
}


/**
 * Finds duplicate audio files in a given list of file paths based on file name similarity.
 * This function runs entirely on the client-side and is optimized for performance.
 * @param filePaths An array of file paths.
 * @returns An array of duplicate groups.
 */
export function findDuplicateGroupsLocally(filePaths: string[]): DuplicateGroup[] {
    const SIMILARITY_THRESHOLD = 0.90; // Stricter threshold

    // Map normalized names to a list of original file paths
    const normalizedMap: Map<string, string[]> = new Map();

    filePaths.forEach(path => {
        const normalized = normalizeFileName(path);
        if (!normalizedMap.has(normalized)) {
            normalizedMap.set(normalized, []);
        }
        normalizedMap.get(normalized)!.push(path);
    });

    const potentialGroups: string[][] = Array.from(normalizedMap.values());
    const finalGroups: DuplicateGroup[] = [];
    const checkedPaths = new Set<string>();

    // Phase 1: Group exact normalized matches
    potentialGroups.forEach(group => {
        if (group.length > 1) {
            finalGroups.push({
                files: group.sort(),
                reason: `Dosya adları "${normalizeFileName(group[0])}" olarak normalleştirildi.`,
                similarityScore: 1.0, // Exact normalized match
            });
            group.forEach(path => checkedPaths.add(path));
        }
    });
    
    // Phase 2: Check for near-matches among remaining unique normalized names
    const singleFileKeys = Array.from(normalizedMap.keys()).filter(key => normalizedMap.get(key)!.length === 1);

    for (let i = 0; i < singleFileKeys.length; i++) {
        const key1 = singleFileKeys[i];
        const path1 = normalizedMap.get(key1)![0];
        if (checkedPaths.has(path1)) continue;

        const currentGroup: string[] = [path1];
        let maxSimilarity = 0;

        for (let j = i + 1; j < singleFileKeys.length; j++) {
            const key2 = singleFileKeys[j];
            const path2 = normalizedMap.get(key2)![0];
            if (checkedPaths.has(path2)) continue;

            const similarity = calculateSimilarity(key1, key2);

            if (similarity > SIMILARITY_THRESHOLD) {
                currentGroup.push(path2);
                checkedPaths.add(path2); // Mark as checked to avoid re-grouping
                if (similarity > maxSimilarity) {
                    maxSimilarity = similarity;
                }
            }
        }

        if (currentGroup.length > 1) {
             finalGroups.push({
                files: currentGroup.sort(),
                reason: `Dosya adları "${key1}" adına benziyor.`,
                similarityScore: maxSimilarity,
            });
            currentGroup.forEach(path => checkedPaths.add(path));
        }
    }


    return finalGroups;
}
