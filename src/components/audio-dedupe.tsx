'use client';

import { useState, useMemo, useCallback, useTransition, useRef, useEffect } from 'react';
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast"
import { FolderSearch, FileScan, Trash2, Loader2, Music2, Folder, AlertTriangle, Info, FolderPlus, Settings, ListMusic, FileX2, FolderX, Search, XCircle, FilterX, PlayCircle, PauseCircle, Download, FileJson } from 'lucide-react';
import type { AppFile, DuplicateGroup, DuplicateGroupWithSelection, FileWithMetadata } from '@/lib/types';
import { Logo } from './logo';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import { Progress } from './ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import jsmediatags from 'jsmediatags';


const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|aac|aiff)$/i;
const RESULTS_PAGE_SIZE = 50;

type ViewState = 'initial' | 'files_selected' | 'analyzing' | 'results';
type SelectionStrategy = 'none' | 'keep_highest_quality' | 'keep_lowest_quality' | 'keep_shortest_name';


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
    
    // Dosya uzantısını kaldır
    name = name.substring(0, name.lastIndexOf('.')) || name;
    
    // Özel son ekleri temizle
    name = name.replace(/_pn$/, '').trim();

    // Sanatçı ve şarkı adını ayırmaya çalış
    const parts = name.split(' - ');
    let artistAndTitle: string;

    // "10A - 125 - Artist - Title" gibi kalıpları işle
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

    // Parantez içindeki versiyon bilgilerini temizle
    let finalName = artistAndTitle.replace(/[\[(](.*?)[\])]/g, (match, content) => {
        const potentialVersion = content.toLowerCase().trim();
        if (VERSION_MARKERS.some(marker => potentialVersion.includes(marker))) {
            return ''; // Versiyon bilgisi içeriyorsa kaldır
        }
        return match; // İçermiyorsa koru
    }).trim();
    
    // Kalan versiyon belirteçlerini temizle
    for (const marker of VERSION_MARKERS) {
        const regex = new RegExp(`\\b${marker}\\b`, 'gi');
        finalName = finalName.replace(regex, '');
    }

    // Özel karakterleri ve fazla boşlukları temizle
    finalName = finalName.replace(/[^\w\s\d]/gi, ' ').replace(/\s+/g, ' ').trim();
    // Sondaki sayıları temizle (genellikle parça numarası)
    finalName = finalName.replace(/-\s*\d{1,3}\s*$/, '').trim();
    finalName = finalName.replace(/\s+\d{1,3}$/, '').trim();

    return finalName;
}

function findDuplicateGroupsLocally(filePaths: string[], similarityThreshold: number): DuplicateGroup[] {
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

  return Array.from(groups.values()).map((files) => {
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


export default function AudioDedupe() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [fileObjects, setFileObjects] = useState<Map<string, File>>(new Map());
  const [filesWithMetadata, setFilesWithMetadata] = useState<Map<string, FileWithMetadata>>(new Map());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupWithSelection[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const recursiveFolderInputRef = useRef<HTMLInputElement>(null);
  const [viewState, setViewState] = useState<ViewState>('initial');
  const [similarityThreshold, setSimilarityThreshold] = useState(0.85);
  const [filterText, setFilterText] = useState('');
  const [resultsSimilarityFilter, setResultsSimilarityFilter] = useState(0.85);
  const [excludeFilterText, setExcludeFilterText] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([]);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<{ path: string; url: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectionStrategy, setSelectionStrategy] = useState<SelectionStrategy>('none');
  const [visibleResultsCount, setVisibleResultsCount] = useState(RESULTS_PAGE_SIZE);

  const { toast } = useToast();

  const handleSelectDirectory = (recursive = false) => {
    if (recursive) {
        recursiveFolderInputRef.current?.click();
    } else {
        folderInputRef.current?.click();
    }
  };


  const processFiles = useCallback((selectedFiles: FileList, isRecursive: boolean) => {
    setError(null);
    setLoadingMessage('Ses dosyaları taranıyor...');
    setViewState('analyzing');

    startTransition(() => {
        const newFileObjects = new Map(fileObjects);
        const newAppFiles: AppFile[] = [];
        
        let basePathSet = new Set<string>();
        if (selectedFiles.length > 0 && selectedFiles[0].webkitRelativePath) {
            const pathParts = selectedFiles[0].webkitRelativePath.split('/');
            if (isRecursive && pathParts.length > 1) {
                basePathSet.add(pathParts[0]);
            }
        }
        const basePath = basePathSet.size > 0 ? Array.from(basePathSet)[0] : '';
        
        Array.from(selectedFiles).forEach(file => {
          if (AUDIO_EXTENSIONS.test(file.name)) {
            const relativePath = file.webkitRelativePath || file.name;
            if (!newFileObjects.has(relativePath)) {
              newFileObjects.set(relativePath, file);
              
              let fileBasePath = '';
              const pathParts = relativePath.split('/');

              if (isRecursive) {
                  fileBasePath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : basePath;
              } else {
                 if (pathParts.length > 1) {
                    fileBasePath = pathParts.slice(0, -1).join('/');
                 }
              }

              newAppFiles.push({
                  handle: { name: file.name, kind: 'file' } as unknown as FileSystemFileHandle,
                  parentHandle: { name: '', kind: 'directory' } as unknown as FileSystemDirectoryHandle,
                  name: file.name,
                  path: relativePath,
                  basePath: fileBasePath || 'Bilinmeyen Klasör',
              });
            }
          }
        });

        if (newAppFiles.length > 0) {
          setFiles(prevFiles => [...prevFiles, ...newAppFiles].sort((a,b) => a.path.localeCompare(b.path)));
          setFileObjects(newFileObjects);
        }
        
        setDuplicateGroups([]);
        setViewState('files_selected');
        setLoadingMessage('');

        if (files.length + newAppFiles.length === 0) {
            setError("Seçilen dizinde desteklenen formatta ses dosyası bulunamadı.");
            setViewState('initial');
        } else {
             toast({ title: `${newAppFiles.length} yeni dosya eklendi`, description: `Toplam ${files.length + newAppFiles.length} dosya analize hazır.` });
        }
    });
  }, [files, fileObjects, toast]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>, isRecursive: boolean) => {
    const selectedFiles = event.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
        processFiles(selectedFiles, isRecursive);
    }
    // Input'u temizle, böylece aynı klasör tekrar seçilebilir
    event.target.value = '';
  };
  
  const readMetadata = (file: File): Promise<FileWithMetadata> => {
      return new Promise((resolve) => {
        jsmediatags.read(file, {
            onSuccess: (tag) => {
                const v2 = (tag.tags as any)?.v2;
                resolve({
                    path: (file as any).webkitRelativePath || file.name,
                    size: file.size,
                    bitrate: v2 && v2.TLEN ? parseInt(v2.TLEN, 10) / 8192 : 0,
                });
            },
            onError: () => {
                resolve({
                    path: (file as any).webkitRelativePath || file.name,
                    size: file.size,
                    bitrate: 0,
                });
            }
        });
    });
  };

   const handleAnalyze = async () => {
    if (files.length === 0) {
      setError('Analiz edilecek dosya yok. Lütfen önce bir klasör seçin.');
      return;
    }
    
    setViewState('analyzing');
    setAnalysisProgress(0);
    setError(null);
    
    // Meta verileri okuma işlemi (tarayıcıda kalır)
    setLoadingMessage('Meta veriler okunuyor...');
    
    const filesToRead = Array.from(fileObjects.values()).filter(file => {
        const path = (file as any).webkitRelativePath || file.name;
        return !filesWithMetadata.has(path);
    });

    const metadataPromises = filesToRead.map(file => readMetadata(file));
    
    let completed = 0;
    metadataPromises.forEach(p => {
        p.then(() => {
            completed++;
            const progress = (completed / metadataPromises.length) * 50; // Meta okuma ilk %50'yi kaplar
            setAnalysisProgress(progress);
        });
    });

    const allMetadata = await Promise.all(metadataPromises);
    
    const newMetadataMap = new Map<string, FileWithMetadata>();
    allMetadata.forEach(meta => newMetadataMap.set(meta.path, meta));
    setFilesWithMetadata(prev => new Map([...prev, ...newMetadataMap]));

    setAnalysisProgress(50);
    setLoadingMessage('Benzer dosyalar analiz ediliyor...');

    try {
        const allFilePaths = files.map(f => f.path);
        
        // Simulating async work for analysis progress
        await new Promise(resolve => setTimeout(resolve, 100));
        setAnalysisProgress(75);

        const groups = findDuplicateGroupsLocally(allFilePaths, similarityThreshold);
        
        const groupsWithSelection = groups
            .map((group, index) => ({
                ...group,
                id: `group-${index}`,
                selection: new Set(group.files.slice(1)), // İlk dosyayı tut, diğerlerini seç
            }))
            .sort((a, b) => b.similarityScore - a.similarityScore);
        
        setDuplicateGroups(groupsWithSelection);
        setResultsSimilarityFilter(similarityThreshold);
        setAnalysisProgress(100);
        
        const initiallyOpen = groupsWithSelection
            .filter(g => g.files.length === 2)
            .map(g => g.id);
        setOpenAccordionItems(initiallyOpen);
        
        if (groupsWithSelection.length === 0) {
            toast({ title: "Kopya bulunamadı", description: "Analiz tamamlandı ancak yinelenen dosya grubu tespit edilmedi." });
        } else {
            toast({ title: "Analiz Tamamlandı", description: `${groupsWithSelection.length} yinelenen grup bulundu.` });
        }

        setViewState('results');
        setLoadingMessage('');

    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Analiz sırasında beklenmedik bir hata oluştu.';
        setError(errorMessage);
        toast({ title: "Analiz Hatası", description: errorMessage, variant: "destructive" });
        setViewState('results');
        setLoadingMessage('');
    }
  };

  useEffect(() => {
    // Component unmount olduğunda audio URL'sini temizle
    return () => {
        if (currentlyPlaying) {
          URL.revokeObjectURL(currentlyPlaying.url);
        }
    };
  }, [currentlyPlaying]);

  const handleToggleSelection = (groupId: string, filePath: string) => {
    setDuplicateGroups(prev => prev.map(group => {
      if (group.id === groupId) {
        const newSelection = new Set(group.selection);
        if (newSelection.has(filePath)) {
          newSelection.delete(filePath);
        } else {
          newSelection.add(filePath);
        }
        return { ...group, selection: newSelection };
      }
      return group;
    }));
  };
  
    const handleToggleGroupSelection = (groupId: string, selectAll: boolean) => {
    setDuplicateGroups(prev => prev.map(group => {
      if (group.id === groupId) {
        // En az bir dosya her zaman tutulmalıdır, bu yüzden ilk dosyayı hariç tut
        const newSelection = selectAll ? new Set(group.files.slice(1)) : new Set<string>();
        return { ...group, selection: newSelection };
      }
      return group;
    }));
  };

  const handleDeleteSelected = async (groupsToDeleteFrom: DuplicateGroupWithSelection[]) => {
    // UYARI: Bu yöntem dosya sistemine erişim API'si (showDirectoryPicker) olmadan çalışmaz.
    // input[type=file] ile seçilen dosyalar üzerinde silme işlemi yapılamaz.
    // Bu fonksiyon şimdilik sadece bir uyarı gösterir.
    toast({
        title: "Silme işlemi uygulanamadı",
        description: "Bu dosya seçim yöntemiyle (klasör ekle) dosya silme desteklenmemektedir.",
        variant: "destructive",
    });
    console.warn("File deletion was attempted, but it is not implemented for the input[type=file] method. The original implementation used showDirectoryPicker which has write access.");
  };
  
  const clearAllFiles = () => {
    setFiles([]);
    setFileObjects(new Map());
    setFilesWithMetadata(new Map());
    setDuplicateGroups([]);
    setError(null);
    setViewState('initial');
    setAnalysisProgress(0);
    toast({title: "Liste Temizlendi", description: "Tüm dosyalar listeden kaldırıldı."})
  }

  const selectedFolders = useMemo(() => {
    const folderSet = new Set<string>();
    files.forEach(file => {
      const pathParts = file.path.split('/');
      if (pathParts.length > 1) {
        // Dosyanın bulunduğu klasör yolunu al
        folderSet.add(pathParts.slice(0, -1).join('/'));
      }
    });
    return Array.from(folderSet).sort();
  }, [files]);

  const removeFolder = (folderPathToRemove: string) => {
      const newFiles = files.filter(file => !file.path.startsWith(folderPathToRemove + '/'));
      const newFileObjects = new Map(fileObjects);
      const newFilesWithMetadata = new Map(filesWithMetadata);

      for (const path of fileObjects.keys()) {
          if (path.startsWith(folderPathToRemove + '/')) {
              newFileObjects.delete(path);
              newFilesWithMetadata.delete(path);
          }
      }

      setFiles(newFiles);
      setFileObjects(newFileObjects);
      setFilesWithMetadata(newFilesWithMetadata);

      setDuplicateGroups([]);
      if (newFiles.length === 0) {
          setViewState('initial');
      } else {
          setViewState('files_selected');
      }
      
      toast({ title: 'Klasör kaldırıldı', description: `${folderPathToRemove} klasörü ve içindekiler listeden çıkarıldı.` });
  };
  
    const filteredDuplicateGroups = useMemo(() => {
    let filtered = duplicateGroups.filter(group => group.similarityScore >= resultsSimilarityFilter);

    if (filterText) {
      const lowercasedFilter = filterText.toLowerCase();
      filtered = filtered.filter(group =>
        group.files.some(file =>
          file.toLowerCase().includes(lowercasedFilter)
        )
      );
    }
    
    if (excludeFilterText) {
        const excludeKeywords = excludeFilterText.toLowerCase().split(' ').filter(k => k);
        if (excludeKeywords.length > 0) {
            filtered = filtered.filter(group =>
                !group.files.some(file =>
                    excludeKeywords.some(keyword => file.toLowerCase().includes(keyword))
                )
            );
        }
    }
    
    return filtered;
  }, [duplicateGroups, filterText, resultsSimilarityFilter, excludeFilterText]);

  const totalSelectedCount = useMemo(() => {
    return filteredDuplicateGroups.reduce((acc, group) => acc + group.selection.size, 0);
  }, [filteredDuplicateGroups]);

    const handlePlayPause = (filePath: string) => {
        if (currentlyPlaying?.path === filePath) {
            if (audioRef.current) {
                if (audioRef.current.paused) {
                    audioRef.current.play();
                } else {
                    audioRef.current.pause();
                }
            }
        } else {
            // Önceki sesin URL'sini temizle
            if (currentlyPlaying) {
                URL.revokeObjectURL(currentlyPlaying.url);
            }
            const file = fileObjects.get(filePath);
            if (file) {
                const url = URL.createObjectURL(file);
                setCurrentlyPlaying({ path: filePath, url });
            }
        }
    };
    
    useEffect(() => {
        const audio = audioRef.current;
        if (audio) {
            const handlePlay = () => setIsPlaying(true);
            const handlePause = () => setIsPlaying(false);
            const handleEnded = () => {
              setIsPlaying(false);
              setCurrentlyPlaying(null);
            };

            audio.addEventListener('play', handlePlay);
            audio.addEventListener('pause', handlePause);
            audio.addEventListener('ended', handleEnded);
            
            if (currentlyPlaying) {
                audio.src = currentlyPlaying.url;
                audio.play().catch(e => console.error("Audio play failed:", e));
            } else {
                audio.pause();
                audio.src = "";
            }
    
            return () => {
                audio.removeEventListener('play', handlePlay);
                audio.removeEventListener('pause', handlePause);
                audio.removeEventListener('ended', handleEnded);
            };
        }
    }, [currentlyPlaying]);

    const applySelectionStrategy = () => {
        if (selectionStrategy === 'none') return;
    
        const newGroups = duplicateGroups.map(group => {
            const filesWithMetaData = group.files
                .map(path => {
                    const meta = filesWithMetadata.get(path) || { path, size: 0, bitrate: 0 };
                    return { ...meta, name: path.split('/').pop() || path };
                });
    
            let fileToKeep: string;
    
            switch (selectionStrategy) {
                case 'keep_highest_quality':
                    // Önce bitrate'e, sonra boyuta göre sırala
                    filesWithMetaData.sort((a, b) => b.bitrate - a.bitrate || b.size - a.size);
                    break;
                case 'keep_lowest_quality':
                     // Önce bitrate'e, sonra boyuta göre sırala
                     filesWithMetaData.sort((a, b) => a.bitrate - b.bitrate || a.size - b.size);
                    break;
                case 'keep_shortest_name':
                    filesWithMetaData.sort((a, b) => a.name.length - b.name.length);
                    break;
                default:
                    // Bilinmeyen strateji, grubu değiştirme
                    return group;
            }
            
            // Sıralamadan sonra ilk dosya tutulacak olan
            fileToKeep = filesWithMetaData.length > 0 ? filesWithMetaData[0].path : '';
            
            // Tutulacak dosya dışındaki tüm dosyaları seç
            const newSelection = new Set(group.files.filter(path => path !== fileToKeep));
            
            return { ...group, selection: newSelection };
        });
    
        setDuplicateGroups(newGroups);
        toast({ title: "Strateji Uygulandı", description: "Yinelenen dosyalar seçilen kurala göre işaretlendi." });
    };

    const visibleGroups = useMemo(() => {
        return filteredDuplicateGroups.slice(0, visibleResultsCount);
    }, [filteredDuplicateGroups, visibleResultsCount]);
  
  const renderInitialView = () => (
      <Card className="shadow-lg w-full max-w-lg mx-auto">
        <CardContent className="p-10 text-center">
            <div className="flex justify-center mb-6">
              <FolderSearch className="h-20 w-20 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Taramaya Başlayın</h2>
            <p className="text-muted-foreground mb-6">Yinelenen ses dosyalarını bulmak için müzik klasör(ler)inizi seçin. Tüm analizler tarayıcınızda, yerel olarak yapılır.</p>
            <div className="flex gap-4 justify-center">
                <Button size="lg" onClick={() => handleSelectDirectory(false)} disabled={isPending}>
                  <FolderPlus className="mr-2 h-5 w-5" />
                  Klasör Ekle
                </Button>
                <Button size="lg" onClick={() => handleSelectDirectory(true)} disabled={isPending}>
                  <FolderSearch className="mr-2 h-5 w-5" />
                  Ana Klasör Ekle
                </Button>
            </div>
        </CardContent>
      </Card>
  );

  const renderResultsView = () => {
    if (filteredDuplicateGroups.length === 0) {
      return (
        <Card className="shadow-lg w-full max-w-lg mx-auto">
            <CardContent className="p-10 text-center">
              <FileScan className="h-20 w-20 text-primary mx-auto mb-6" />
              <h2 className="text-2xl font-bold">Analiz Tamamlandı</h2>
              <p className="text-muted-foreground">{filterText || excludeFilterText ? 'Arama kriterlerinize uyan kopya bulunamadı.' : 'Tebrikler! Müzik kütüphanenizde yinelenen dosya bulunamadı.'}</p>
            </CardContent>
        </Card>
      );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Analiz Sonuçları</CardTitle>
                        <CardDescription>{filteredDuplicateGroups.length} grup benzer dosya bulundu.</CardDescription>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" disabled={totalSelectedCount === 0 || isPending}>
                             <Trash2 className="mr-2" /> Seçilenleri Sil ({totalSelectedCount})
                           </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Bu işlem {totalSelectedCount} dosyayı kalıcı olarak silecektir. Bu eylem geri alınamaz.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>İptal</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteSelected(filteredDuplicateGroups)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Evet, Sil</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </CardHeader>
            </Card>
            <Accordion 
                type="multiple"
                className="w-full space-y-4"
                value={openAccordionItems}
                onValueChange={setOpenAccordionItems}
            >
            {visibleGroups.map(group => {
              const isGroupFullySelected = group.selection.size > 0 && group.selection.size === group.files.length - 1;
              return (
              <Card key={group.id} className="overflow-hidden transition-all duration-300">
                <AccordionItem value={group.id} className="border-b-0">
                  <div className="flex items-center p-4 pr-1 hover:bg-muted/50">
                    <Checkbox
                        checked={isGroupFullySelected}
                        onCheckedChange={(checked) => handleToggleGroupSelection(group.id, !!checked)}
                        aria-label="Tüm grubu seç/bırak"
                        className="mr-3"
                    />
                    <AccordionTrigger className="flex-1 p-0 hover:no-underline text-left">
                        <div className="flex-1">
                          <div className='flex items-center justify-between'>
                             <div className="flex items-center gap-3">
                                 <ListMusic className="w-5 h-5 text-primary" />
                                 <p className="font-semibold text-lg">{group.files.length} Benzer Dosya Grubu</p>
                             </div>
                             <Badge variant={group.similarityScore > 0.9 ? 'default' : 'secondary'}>
                                Benzerlik: {Math.round(group.similarityScore * 100)}%
                             </Badge>
                          </div>
                          <div className="flex items-center text-sm text-muted-foreground mt-1 gap-2">
                            <Info className="w-4 h-4 flex-shrink-0"/>
                            <span className="font-mono text-xs truncate" title={group.reason}>{group.reason}</span>
                          </div>
                        </div>
                    </AccordionTrigger>
                  </div>
                  <AccordionContent className="p-0">
                    <div className="border-t bg-background/30">
                      <ul className="p-4 space-y-3">
                        {group.files.map(filePath => {
                          const fileName = filePath.split('/').pop() || filePath;
                          const dirPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
                          const isCurrentlyPlaying = currentlyPlaying?.path === filePath;
                          return (
                              <li key={filePath} className="flex items-center gap-4 p-2 rounded-md hover:bg-muted/50 transition-colors">
                                <Checkbox
                                    id={`${group.id}-${filePath}`}
                                    checked={group.selection.has(filePath)}
                                    onCheckedChange={() => handleToggleSelection(group.id, filePath)}
                                    aria-label={`Dosyayı seç ${filePath}`}
                                />
                                <div className="flex-1 overflow-hidden">
                                    <label htmlFor={`${group.id}-${filePath}`} className="font-medium flex items-center gap-2 cursor-pointer">
                                      <Music2 className="w-4 h-4 text-primary flex-shrink-0" />
                                      <span className="truncate" title={fileName}>{fileName}</span>
                                    </label>
                                    <p className="text-xs text-muted-foreground flex items-center gap-2 mt-1 truncate">
                                      <Folder className="w-3 h-3 flex-shrink-0" />
                                      <span className="truncate" title={dirPath}>{dirPath}</span>
                                    </p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePlayPause(filePath)}>
                                    {isCurrentlyPlaying && isPlaying ? <PauseCircle className="text-primary" /> : <PlayCircle />}
                                </Button>
                              </li>
                          );
                        })}
                      </ul>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Card>
              )
            })}
          </Accordion>
           {filteredDuplicateGroups.length > visibleResultsCount && (
                <div className="text-center mt-6">
                    <Button onClick={() => setVisibleResultsCount(c => c + RESULTS_PAGE_SIZE)}>
                        <Download className="mr-2 h-4 w-4" />
                        Daha Fazla Yükle ({visibleResultsCount} / {filteredDuplicateGroups.length})
                    </Button>
                </div>
            )}
        </div>
      );
  }

  const renderContent = () => {
    if (viewState === 'analyzing') {
       return (
            <Card className="shadow-lg w-full max-w-lg mx-auto">
                <CardContent className="p-10 text-center space-y-6">
                  <div className="flex flex-col items-center justify-center text-center">
                    <Loader2 className="h-16 w-16 animate-spin text-primary mb-6" />
                    <h2 className="text-2xl font-bold mb-2">Analiz Ediliyor</h2>
                    <p className="text-muted-foreground mb-4">{loadingMessage}</p>
                    <Progress value={analysisProgress} className="w-full" />
                  </div>
                </CardContent>
            </Card>
       );
    }
    
    if (viewState === 'results' || (viewState === 'files_selected' && files.length > 0)) {
        if (duplicateGroups.length > 0 || viewState === 'results') {
            return renderResultsView();
        }
    }
    
    return renderInitialView();
  };
  
  return (
    <SidebarProvider>
       <input 
          type="file" 
          ref={folderInputRef} 
          style={{ display: 'none' }} 
          onChange={(e) => handleFileSelect(e, false)}
          webkitdirectory="true"
          mozdirectory="true"
          multiple
        />
        <input 
          type="file" 
          ref={recursiveFolderInputRef} 
          style={{ display: 'none' }} 
          onChange={(e) => handleFileSelect(e, true)}
          webkitdirectory="true"
          mozdirectory="true"
          multiple
        />
      <Sidebar collapsible="icon" className="border-r">
          <SidebarHeader className='p-4'>
             <div className="flex items-center gap-2">
                <Logo />
             </div>
          </SidebarHeader>
          <Separator />
          <SidebarContent className="p-0">
             <SidebarGroup className="p-2">
                 <SidebarGroupLabel className="flex items-center gap-2">
                     <Settings />
                     Kontrol Paneli
                 </SidebarGroupLabel>
                 <div className='p-2 space-y-4'>
                      <div className="space-y-2">
                        <Label htmlFor="similarity-threshold">Analiz Benzerlik Eşiği: {Math.round(similarityThreshold * 100)}%</Label>
                        <Slider
                          id="similarity-threshold"
                          min={0.5}
                          max={1}
                          step={0.01}
                          value={[similarityThreshold]}
                          onValueChange={(value) => setSimilarityThreshold(value[0])}
                          disabled={isPending || viewState === 'analyzing'}
                        />
                        <p className="text-xs text-muted-foreground">Düşük değerler daha fazla kopya bulur.</p>
                      </div>

                     <Button className="w-full" onClick={handleAnalyze} disabled={isPending || files.length === 0 || viewState === 'analyzing'}>
                         {viewState === 'analyzing' ? <Loader2 className="animate-spin" /> : <FileScan />}
                         {viewState === 'analyzing' ? 'Analiz Ediliyor...' : 'Analizi Başlat'}
                     </Button>
                     
                     {viewState === 'results' && (
                        <>
                            <Separator />
                             <Label>Sonuç Filtreleri</Label>
                             <div className="space-y-2">
                                <Label htmlFor="results-similarity-filter">Sonuç Benzerlik Eşiği: {Math.round(resultsSimilarityFilter * 100)}%</Label>
                                <Slider
                                id="results-similarity-filter"
                                min={0.5}
                                max={1}
                                step={0.01}
                                value={[resultsSimilarityFilter]}
                                onValueChange={(value) => setResultsSimilarityFilter(value[0])}
                                />
                            </div>
                         <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="İçerenleri göster..."
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                className="pl-9"
                            />
                             {filterText && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                                    onClick={() => setFilterText('')}
                                >
                                    <XCircle className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                        <div className="relative">
                            <FilterX className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="İçerenleri gizle..."
                                value={excludeFilterText}
                                onChange={(e) => setExcludeFilterText(e.target.value)}
                                className="pl-9"
                            />
                             {excludeFilterText && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                                    onClick={() => setExcludeFilterText('')}
                                >
                                    <XCircle className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                        <Separator />
                        <div className="space-y-2">
                            <Label>Otomatik Seçim Stratejisi</Label>
                             <Select onValueChange={(value: SelectionStrategy) => setSelectionStrategy(value)} defaultValue="none">
                                <SelectTrigger>
                                    <SelectValue placeholder="Bir strateji seçin..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Manuel Seçim</SelectItem>
                                    <SelectItem value="keep_highest_quality">En Yüksek Kaliteliyi Tut</SelectItem>
                                    <SelectItem value="keep_lowest_quality">En Düşük Kaliteliyi Tut</SelectItem>
                                    <SelectItem value="keep_shortest_name">En Kısa Dosya Adını Tut</SelectItem>
                                </SelectContent>
                            </Select>
                            <Button className="w-full" variant="outline" onClick={applySelectionStrategy} disabled={selectionStrategy === 'none'}>
                                <FileJson className="mr-2" /> Stratejiyi Uygula
                            </Button>
                            <p className="text-xs text-muted-foreground">Dosya kalitesi, bitrate ve dosya boyutuna göre belirlenir.</p>
                        </div>
                        </>
                     )}
                 </div>
             </SidebarGroup>
             <Separator />
             <SidebarGroup className="p-2">
                 <SidebarGroupLabel className="flex items-center gap-2">
                     <ListMusic />
                     Taranan Klasörler ({selectedFolders.length})
                 </SidebarGroupLabel>
                 {selectedFolders.length > 0 ? (
                    <ScrollArea className="h-60 w-full rounded-md border">
                        <div className="p-1">
                            {selectedFolders.map(folder => (
                                <div key={folder} className="group flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                  <p className="text-sm truncate" title={folder}>
                                    <Folder className="inline-block w-4 h-4 mr-2 text-primary" />
                                    {folder}
                                  </p>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                                    onClick={() => removeFolder(folder)}
                                  >
                                      <FolderX className="w-4 h-4 text-destructive" />
                                  </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                 ) : (
                    <div className="text-center text-sm text-muted-foreground p-4">
                        <p>Henüz klasör eklenmedi.</p>
                    </div>
                 )}
             </SidebarGroup>
          </SidebarContent>
           <Separator />
          <SidebarFooter className='p-4 gap-2 flex-col'>
            <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => handleSelectDirectory(false)} disabled={isPending || viewState === 'analyzing'}>
                    <FolderPlus />
                    Klasör
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => handleSelectDirectory(true)} disabled={isPending || viewState === 'analyzing'}>
                    <FolderSearch />
                    Ana Klasör
                </Button>
            </div>
            <Button variant="ghost" className="text-destructive hover:text-destructive w-full" onClick={clearAllFiles} disabled={files.length === 0 || isPending || viewState === 'analyzing'}>
                <FileX2 />
                Listeyi Temizle
            </Button>
          </SidebarFooter>
      </Sidebar>
      <SidebarInset className="max-w-7xl mx-auto p-4 md:p-8 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
                <SidebarTrigger className="md:hidden" />
                <div className='hidden md:block'>
                  <h1 className="text-2xl font-bold tracking-tight">Kopya Ses Dosyası Bulucu</h1>
                  <p className="text-muted-foreground">Müzik kütüphanenizi düzenleyin ve yerden tasarruf edin.</p>
                </div>
            </div>
          </div>

        {error && (
            <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div>
                    <p className="font-semibold">Bir Hata Oluştu</p>
                    <p className="text-sm">{error}</p>
                </div>
            </div>
        )}
        <div className="flex-1 overflow-auto">
            {renderContent()}
        </div>
        
        <audio ref={audioRef} hidden />

        {currentlyPlaying && (
            <Card className="fixed bottom-4 right-4 w-96 shadow-2xl z-50 p-4 border-primary/20 bg-background/80 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => handlePlayPause(currentlyPlaying.path)}>
                        {isPlaying ? <PauseCircle className="h-8 w-8 text-primary"/> : <PlayCircle className="h-8 w-8 text-primary"/>}
                    </Button>
                    <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-medium truncate" title={currentlyPlaying.path.split('/').pop()}>
                            {currentlyPlaying.path.split('/').pop()}
                        </p>
                         <p className="text-xs text-muted-foreground truncate" title={currentlyPlaying.path}>
                            Şimdi Oynatılıyor...
                        </p>
                    </div>
                     <Button variant="ghost" size="icon" onClick={() => { setCurrentlyPlaying(null); }}>
                        <XCircle className="h-5 w-5"/>
                    </Button>
                </div>
            </Card>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
