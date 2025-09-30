import type { DuplicateGroup } from './types';

/**
 * Calculates the similarity between two strings using the Levenshtein distance.
 * @param s1 The first string.
 * @param s2 The second string.
 * @returns A similarity score between 0 and 1.
 */
function calculateSimilarity(s1: string, s2: string): number {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
        longer = s2;
        shorter = s1;
    }
    const longerLength = longer.length;
    if (longerLength === 0) {
        return 1.0;
    }
    return (longerLength - editDistance(longer, shorter)) / longerLength;
}

/**
 * Calculates the Levenshtein distance between two strings.
 * @param s1 The first string.
 * @param s2 The second string.
 * @returns The Levenshtein distance.
 */
function editDistance(s1: string, s2: string): number {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i == 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) != s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }
    return costs[s2.length];
}

/**
 * Normalizes a file name for comparison by removing common duplicate markers and extensions.
 * @param filePath The path to the file.
 * @returns A normalized file name.
 */
function normalizeFileName(filePath: string): string {
    let name = (filePath.split('/').pop() || '').toLowerCase();
    // Remove extension
    name = name.substring(0, name.lastIndexOf('.')) || name;
    // Remove common duplicate markers like (1), - copy, etc.
    name = name.replace(/\(\d+\)$/, '').trim(); // (1), (2)
    name = name.replace(/\[\d+\]$/, '').trim(); // [1], [2]
    name = name.replace(/-\s*\d+$/, '').trim(); // - 1, -2
    name = name.replace(/-\s*copy\s*\d*$/, '').trim(); // - copy, - copy 2
    name = name.replace(/-\s*kopya\s*\d*$/, '').trim(); // - kopya, - kopya 2
    name = name.replace(/\(copy\)$/, '').trim(); // (copy)
    name = name.replace(/\(kopya\)$/, '').trim(); // (kopya)
    // Remove common version/remix markers for base comparison
    name = name.replace(/\(remix\)|\[remix\]/i, '').trim();
    name = name.replace(/\(live\)|\[live\]/i, '').trim();
    name = name.replace(/\(acoustic\)|\[acoustic\]/i, '').trim();
    name = name.replace(/-\s*remix$/i, '').trim();
    name = name.replace(/-\s*live$/i, '').trim();
    name = name.replace(/-\s*acoustic$/i, '').trim();
    // Remove special characters
    name = name.replace(/[^\w\s]/gi, '').trim();

    return name;
}


/**
 * Finds duplicate audio files in a given list of file paths based on file name similarity.
 * This function runs entirely on the client-side.
 * @param filePaths An array of file paths.
 * @returns An array of duplicate groups.
 */
export function findDuplicateGroupsLocally(filePaths: string[]): DuplicateGroup[] {
    const groups: { [key: string]: string[] } = {};
    const checked = new Set<string>();

    for (let i = 0; i < filePaths.length; i++) {
        if (checked.has(filePaths[i])) {
            continue;
        }

        const groupKey = filePaths[i];
        groups[groupKey] = [filePaths[i]];
        checked.add(filePaths[i]);

        const normalizedName1 = normalizeFileName(filePaths[i]);

        for (let j = i + 1; j < filePaths.length; j++) {
            if (checked.has(filePaths[j])) {
                continue;
            }

            const normalizedName2 = normalizeFileName(filePaths[j]);
            const similarity = calculateSimilarity(normalizedName1, normalizedName2);

            if (similarity > 0.85) { // Similarity threshold
                groups[groupKey].push(filePaths[j]);
                checked.add(filePaths[j]);
            }
        }
    }

    return Object.values(groups)
        .filter(group => group.length > 1)
        .map(group => {
            const normalizedBaseName = normalizeFileName(group[0]);
            // Calculate average similarity for the group
            let totalSimilarity = 0;
            let comparisons = 0;
            for(let i = 0; i < group.length; i++) {
                for(let j = i + 1; j < group.length; j++) {
                    totalSimilarity += calculateSimilarity(normalizeFileName(group[i]), normalizeFileName(group[j]));
                    comparisons++;
                }
            }
            const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 1;

            return {
                files: group.sort(),
                reason: `Dosya adları "${normalizedBaseName}" adına benziyor.`,
                similarityScore: avgSimilarity,
            };
        });
}
