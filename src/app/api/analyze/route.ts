import { NextResponse } from 'next/server';

export const runtime = 'edge'; // Vercel Edge Fonksiyonu olarak çalıştır

// Levenshtein mesafesi hesaplama fonksiyonu
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

// İki string arasındaki benzerlik oranını hesaplar
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

// Dosya adını normalize eder
function normalizeFileName(filePath: string): string {
    let name = (filePath.split('/').pop() || '').toLowerCase();
    
    name = name.substring(0, name.lastIndexOf('.')) || name;
    name = name.replace(/_pn$/, '').trim();

    const parts = name.split(' - ');
    let artistAndTitle: string;

    if (parts.length >= 3) {
        const isCamelot = /^\d{1,2}[ab]$/.test(parts[0].trim());
        const isBpm = /^\d{2,3}$/.test(parts[1].trim());

        if (isCamelot && isBpm && parts.length >= 4) {
            artistAndTitle = parts.slice(2).join(' ');
        } else if (isCamelot) {
            artistAndTitle = parts.slice(1).join(' ');
        } else {
            artistAndTitle = parts.join(' ');
        }
    } else {
        artistAndTitle = name;
    }

    let finalName = artistAndTitle.replace(/[\[(](.*?)[\])]/g, (match, content) => {
        const potentialVersion = content.toLowerCase().trim();
        if (VERSION_MARKERS.some(marker => potentialVersion.includes(marker))) {
            return '';
        }
        return match;
    }).trim();
    
    for (const marker of VERSION_MARKERS) {
        const regex = new RegExp(`\\b${marker}\\b`, 'gi');
        finalName = finalName.replace(regex, '');
    }

    finalName = finalName.replace(/[^\w\s\d]/gi, ' ').replace(/\s+/g, ' ').trim();
    finalName = finalName.replace(/-\s*\d{1,3}\s*$/, '').trim();
    finalName = finalName.replace(/\s+\d{1,3}$/, '').trim();

    return finalName;
}

export async function POST(request: Request) {
  try {
    const { filePaths, similarityThreshold = 0.85 } = await request.json();

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return NextResponse.json({ error: 'filePaths array is required.' }, { status: 400 });
    }

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

        const newGroup = [fileA.path];
        
        for (let j = i + 1; j < filesWithNormalizedNames.length; j++) {
            const fileB = filesWithNormalizedNames[j];
            if (checkedPaths.has(fileB.path) || !fileB.normalized) {
                continue;
            }
            
            const similarity = calculateSimilarity(fileA.normalized, fileB.normalized);

            if (similarity >= similarityThreshold) {
                newGroup.push(fileB.path);
                checkedPaths.add(fileB.path);
            }
        }

        if (newGroup.length > 1) {
            checkedPaths.add(fileA.path);
            groups.set(fileA.path, newGroup);
        }
    }

    const result = Array.from(groups.values()).map((files) => {
        const firstFileNormalized = normalizeFileName(files[0]);
        let score = 0;
        if (files.length > 1) {
            const secondFileNormalized = normalizeFileName(files[1]);
            score = calculateSimilarity(firstFileNormalized, secondFileNormalized);
        }

        return {
            files: files.sort(),
            reason: `Dosya adları "${firstFileNormalized}" adına benziyor.`,
            similarityScore: score,
        };
    }).filter(group => group.files.length > 1);

    return NextResponse.json(result);

  } catch (error) {
    console.error('Analysis API error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
