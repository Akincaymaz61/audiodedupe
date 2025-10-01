import type { DuplicateGroup } from './types';

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


export function findDuplicateGroupsLocally(filePaths: string[], similarityThreshold: number): DuplicateGroup[] {
  const normalizedMap = new Map<string, string[]>();

  // 1. Adım: Dosyaları normalize edilmiş adlarına göre önceden grupla (Çok Hızlı)
  for (const path of filePaths) {
      const normalized = normalizeFileName(path);
      if (!normalized) continue;
      
      if (!normalizedMap.has(normalized)) {
          normalizedMap.set(normalized, []);
      }
      normalizedMap.get(normalized)!.push(path);
  }
  
  const initialGroups = Array.from(normalizedMap.values());
  const finalGroups: string[][] = [];
  const processedGroups = new Set<number>();

  // 2. Adım: Sadece grup anahtarları (normalize edilmiş adlar) arasında benzerlik kontrolü yap
  const groupKeys = Array.from(normalizedMap.keys());
  
  for (let i = 0; i < groupKeys.length; i++) {
      if (processedGroups.has(i)) {
          continue;
      }
      
      const currentGroupFiles = normalizedMap.get(groupKeys[i])!;
      const mergedGroup = [...currentGroupFiles];
      processedGroups.add(i);

      for (let j = i + 1; j < groupKeys.length; j++) {
          if (processedGroups.has(j)) {
              continue;
          }
          
          const similarity = calculateSimilarity(groupKeys[i], groupKeys[j]);
          
          if (similarity >= similarityThreshold) {
              const groupToMerge = normalizedMap.get(groupKeys[j])!;
              mergedGroup.push(...groupToMerge);
              processedGroups.add(j);
          }
      }
      if(mergedGroup.length > 1){
        finalGroups.push(mergedGroup);
      }
  }
    
    // Grupları tam eşleşenleri de dahil ederek birleştir
    initialGroups.forEach(group => {
        if(group.length > 1) {
            let found = false;
            for(const finalGroup of finalGroups) {
                if(finalGroup.includes(group[0])) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                finalGroups.push(group);
            }
        }
    });


  return finalGroups.map((files) => {
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
}
