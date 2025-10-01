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
import { FolderSearch, FileScan, Trash2, Loader2, Music2, Folder, AlertTriangle, Info, FolderPlus, Settings, ListMusic, FileX2, FolderX, Search, XCircle, FilterX, PlayCircle, PauseCircle, Download, FileJson, SortDesc, Timer, FileDigit, ArrowUpCircle, CheckCheck, X } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { findDuplicateGroupsLocally } from '@/lib/local-analyzer';
import jsmediatags from 'jsmediatags';
import { cn } from '@/lib/utils';


const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|aac|aiff)$/i;
const RESULTS_PAGE_SIZE = 50;

type ViewState = 'initial' | 'files_selected' | 'analyzing' | 'results';
type SelectionStrategy = 'none' | 'keep_highest_quality' | 'keep_lowest_quality' | 'keep_shortest_name';
type SortOption = 
  | 'similarity_desc' 
  | 'similarity_asc' 
  | 'count_desc' 
  | 'count_asc';

type AnalysisStats = {
  duration: number; // in seconds
  scannedFiles: number;
  foundGroups: number;
} | null;

const sortOptions: Record<SortOption, string> = {
  similarity_desc: 'Benzerlik Oranı (Yüksekten Düşüğe)',
  similarity_asc: 'Benzerlik Oranı (Düşükten Yükseğe)',
  count_desc: 'Dosya Sayısı (Çoktan Aza)',
  count_asc: 'Dosya Sayısı (Azdan Çoğa)',
};


async function getFilesFromDirectory(dirHandle: FileSystemDirectoryHandle, recursive: boolean, path = ''): Promise<AppFile[]> {
    const files: AppFile[] = [];
    for await (const entry of dirHandle.values()) {
        const newPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file' && AUDIO_EXTENSIONS.test(entry.name)) {
            files.push({
                handle: entry,
                parentHandle: dirHandle,
                name: entry.name,
                path: newPath,
                basePath: path || dirHandle.name,
            });
        } else if (entry.kind === 'directory' && recursive) {
            files.push(...(await getFilesFromDirectory(entry, recursive, newPath)));
        }
    }
    return files;
}

export default function AudioDedupe() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [fileObjects, setFileObjects] = useState<Map<string, File>>(new Map());
  const [filesWithMetadata, setFilesWithMetadata] = useState<Map<string, FileWithMetadata>>(new Map());
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupWithSelection[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
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
  const [activeFolderCard, setActiveFolderCard] = useState<string | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('similarity_desc');
  const [analysisStats, setAnalysisStats] = useState<AnalysisStats>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const analysisCancellation = useRef(false);


  const { toast } = useToast();

    const handleSelectDirectory = async (recursive = false) => {
        if (!window.showDirectoryPicker) {
            setError("Tarayıcınız bu özelliği desteklemiyor. Lütfen Chrome, Edge veya Opera'nın güncel bir sürümünü kullanın.");
            return;
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            setError(null);
            setLoadingMessage('Ses dosyaları taranıyor...');
            setViewState('analyzing');

            startTransition(async () => {
                const newAppFiles = await getFilesFromDirectory(dirHandle, recursive, dirHandle.name);
                
                if (newAppFiles.length > 0) {
                    const existingPaths = new Set(files.map(f => f.path));
                    const uniqueNewFiles = newAppFiles.filter(f => !existingPaths.has(f.path));
                    
                    if (uniqueNewFiles.length > 0) {
                        setFiles(prevFiles => [...prevFiles, ...uniqueNewFiles].sort((a,b) => a.path.localeCompare(b.path)));
                        toast({ title: `${uniqueNewFiles.length} yeni dosya eklendi`, description: `Toplam ${files.length + uniqueNewFiles.length} dosya analize hazır.` });
                    } else {
                        toast({ title: "Yeni dosya eklenmedi", description: "Seçilen klasördeki dosyalar zaten listede mevcut.", variant: "default" });
                    }
                }
                
                setDuplicateGroups([]);
                setViewState('files_selected');
                setLoadingMessage('');

                if (files.length + newAppFiles.length === 0) {
                    setError("Seçilen dizinde desteklenen formatta ses dosyası bulunamadı.");
                    setViewState('initial');
                }
            });
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                 console.error('Klasör seçme hatası:', err);
                 setError(`Klasör seçilemedi: ${(err as Error).message}`);
            }
            setViewState(files.length > 0 ? 'files_selected' : 'initial');
            setLoadingMessage('');
        }
    };
  
  const readMetadata = (file: File): Promise<FileWithMetadata> => {
      return new Promise((resolve) => {
        jsmediatags.read(file, {
            onSuccess: (tag) => {
                const v2 = (tag.tags as any)?.v2;
                resolve({
                    path: (file as any).webkitRelativePath || file.name,
                    size: file.size,
                    bitrate: (v2 && v2.TLEN) ? parseInt(v2.TLEN, 10) / 8192 : 0,
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
    
    analysisCancellation.current = false;
    setViewState('analyzing');
    setAnalysisProgress(0);
    setError(null);
    setLoadingMessage('Meta veriler okunuyor...');
    setAnalysisStats(null);
    const startTime = performance.now();

    const filesToRead: File[] = [];
    const newFileObjects = new Map<string, File>();

    try {
        const filePromises = files
            .filter(appFile => !fileObjects.has(appFile.path))
            .map(async (appFile) => {
                const file = await appFile.handle.getFile();
                filesToRead.push(file);
                newFileObjects.set(appFile.path, file);
            });
        
        await Promise.all(filePromises);
        if (analysisCancellation.current) return;
        setFileObjects(prev => new Map([...prev, ...newFileObjects]));

    } catch (e) {
        if (analysisCancellation.current) return;
        const errorMessage = e instanceof Error ? e.message : 'Dosya okuma sırasında beklenmedik bir hata oluştu.';
        setError(`Dosyalara erişirken bir hata oluştu: ${errorMessage}. Lütfen klasör izinlerini kontrol edin.`);
        toast({ title: "Dosya Erişim Hatası", description: errorMessage, variant: "destructive" });
        setViewState('files_selected');
        return;
    }

    const metadataPromises = filesToRead.map(file => readMetadata(file));
    
    let completed = 0;
    metadataPromises.forEach(p => {
        p.then(() => {
            if (analysisCancellation.current) return;
            completed++;
            const progress = (completed / metadataPromises.length) * 50; 
            setAnalysisProgress(progress);
        });
    });

    try {
        const allMetadata = await Promise.all(metadataPromises);
        if (analysisCancellation.current) return;
        
        const newMetadataMap = new Map<string, FileWithMetadata>();
        allMetadata.forEach(meta => newMetadataMap.set(meta.path, meta));
        setFilesWithMetadata(prev => new Map([...prev, ...newMetadataMap]));

        setAnalysisProgress(50);
        setLoadingMessage('Benzer dosyalar analiz ediliyor...');

        const allFilePaths = files.map(f => f.path);
        
        await new Promise(resolve => setTimeout(resolve, 100)); // UI update için
        if (analysisCancellation.current) return;
        setAnalysisProgress(75);

        const groups = findDuplicateGroupsLocally(allFilePaths, similarityThreshold);
        if (analysisCancellation.current) return;
        
        const groupsWithSelection = groups
            .map((group, index) => ({
                ...group,
                id: `group-${index}`,
                selection: new Set(group.files.slice(1)), 
            }))
            .sort((a, b) => b.similarityScore - a.similarityScore);
        
        setDuplicateGroups(groupsWithSelection);
        setResultsSimilarityFilter(similarityThreshold);
        setAnalysisProgress(100);
        
        const endTime = performance.now();
        setAnalysisStats({
          duration: (endTime - startTime) / 1000,
          scannedFiles: files.length,
          foundGroups: groupsWithSelection.length,
        });

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
        if (analysisCancellation.current) return;
        const errorMessage = e instanceof Error ? e.message : 'Analiz sırasında beklenmedik bir hata oluştu.';
        setError(errorMessage);
        toast({ title: "Analiz Hatası", description: errorMessage, variant: "destructive" });
        setViewState('results');
        setLoadingMessage('');
    }
  };

  const cancelAnalysis = () => {
    analysisCancellation.current = true;
    setViewState('files_selected');
    setLoadingMessage('');
    setAnalysisProgress(0);
    toast({ title: "Analiz İptal Edildi", description: "Kullanıcı tarafından analiz işlemi durduruldu." });
  };

  useEffect(() => {
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
        const newSelection = selectAll ? new Set(group.files.slice(1)) : new Set<string>();
        return { ...group, selection: newSelection };
      }
      return group;
    }));
  };

  const handleSelectAll = (select: boolean) => {
    setDuplicateGroups(prev => prev.map(group => {
        const newSelection = select ? new Set(group.files.slice(1)) : new Set<string>();
        return { ...group, selection: newSelection };
    }));
    toast({
        title: select ? "Tümü Seçildi" : "Tüm Seçimler Kaldırıldı",
        description: select ? "Tüm gruplardaki yinelenen dosyalar (ilk dosya hariç) seçildi." : "Tüm gruplardaki seçimler temizlendi."
    });
  };

  const handleDeleteSelected = async (groupsToDeleteFrom: DuplicateGroupWithSelection[]) => {
      const filesToDelete = new Map<string, AppFile>();
      const allFilesMap = new Map(files.map(f => [f.path, f]));

      for (const group of groupsToDeleteFrom) {
          for (const path of group.selection) {
              const file = allFilesMap.get(path);
              if (file && !filesToDelete.has(path)) {
                  filesToDelete.set(path, file);
              }
          }
      }

      if (filesToDelete.size === 0) {
          toast({ title: "Silinecek dosya seçilmedi", variant: "default" });
          return;
      }
      
      let deletedCount = 0;
      let errorCount = 0;
      
      const parentHandles = new Set<FileSystemDirectoryHandle>();
      filesToDelete.forEach(file => parentHandles.add(file.parentHandle));
      
      try {
          for(const handle of parentHandles){
             const permission = await handle.queryPermission({ mode: 'readwrite' });
             if (permission !== 'granted') {
                const request = await handle.requestPermission({ mode: 'readwrite' });
                if(request !== 'granted'){
                    throw new Error("Dosyaları silmek için gerekli izin verilmedi.");
                }
             }
          }

          const deletionPromises = Array.from(filesToDelete.values()).map(async (file) => {
              try {
                  await file.parentHandle.removeEntry(file.name);
                  deletedCount++;
              } catch (e) {
                  console.error(`Dosya silinemedi: ${file.path}`, e);
                  errorCount++;
              }
          });

          await Promise.all(deletionPromises);
          
          toast({
              title: "Silme İşlemi Tamamlandı",
              description: `${deletedCount} dosya başarıyla silindi. ${errorCount > 0 ? `${errorCount} dosya silinemedi.` : ''}`
          });
          
          // Update state after deletion
          const remainingFilePaths = new Set(Array.from(filesToDelete.keys()));
          setFiles(prev => prev.filter(f => !remainingFilePaths.has(f.path)));
          setDuplicateGroups(prev => 
              prev.map(g => ({
                  ...g,
                  files: g.files.filter(f => !remainingFilePaths.has(f)),
                  selection: new Set([...g.selection].filter(f => !remainingFilePaths.has(f)))
              })).filter(g => g.files.length > 1)
          );
          setFileObjects(prev => {
              const newMap = new Map(prev);
              remainingFilePaths.forEach(path => newMap.delete(path));
              return newMap;
          });
          setFilesWithMetadata(prev => {
              const newMap = new Map(prev);
              remainingFilePaths.forEach(path => newMap.delete(path));
              return newMap;
          });

      } catch (e) {
          const errorMessage = e instanceof Error ? e.message : "Bilinmeyen bir hata oluştu.";
          setError(`Dosyaları silerken bir hata oluştu: ${errorMessage}`);
          toast({ title: "Silme Hatası", description: errorMessage, variant: "destructive" });
      }
  };
  
  const clearAllFiles = () => {
    setFiles([]);
    setFileObjects(new Map());
    setFilesWithMetadata(new Map());
    setDuplicateGroups([]);
    setError(null);
    setViewState('initial');
    setAnalysisProgress(0);
    setAnalysisStats(null);
    toast({title: "Liste Temizlendi", description: "Tüm dosyalar listeden kaldırıldı."})
  }

  const selectedFoldersWithCounts = useMemo(() => {
    const folderMap = new Map<string, number>();
    files.forEach(file => {
      const path = file.basePath;
      folderMap.set(path, (folderMap.get(path) || 0) + 1);
    });
    return Array.from(folderMap.entries())
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [files]);

  const selectedFolders = useMemo(() => {
      return selectedFoldersWithCounts.map(f => f.path);
  }, [selectedFoldersWithCounts]);


  const removeFolder = useCallback((folderPathToRemove: string) => {
      const newFiles = files.filter(file => file.basePath !== folderPathToRemove);
      const pathsToRemove = new Set(files.filter(file => file.basePath === folderPathToRemove).map(f => f.path));

      const newFileObjects = new Map(fileObjects);
      const newFilesWithMetadata = new Map(filesWithMetadata);
      
      pathsToRemove.forEach(path => {
          newFileObjects.delete(path);
          newFilesWithMetadata.delete(path);
      });

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
  }, [files, fileObjects, filesWithMetadata, toast]);
  
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
    
    const sorted = [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'similarity_desc':
          return b.similarityScore - a.similarityScore;
        case 'similarity_asc':
          return a.similarityScore - b.similarityScore;
        case 'count_desc':
          return b.files.length - a.files.length;
        case 'count_asc':
          return a.files.length - b.files.length;
        default:
          return 0;
      }
    });

    return sorted;
  }, [duplicateGroups, filterText, resultsSimilarityFilter, excludeFilterText, sortOption]);

  const totalSelectedCount = useMemo(() => {
    return filteredDuplicateGroups.reduce((acc, group) => acc + group.selection.size, 0);
  }, [filteredDuplicateGroups]);

  const areAllSelected = useMemo(() => {
      if (filteredDuplicateGroups.length === 0) return false;
      return filteredDuplicateGroups.every(group => {
          const selectableFiles = group.files.slice(1);
          if (selectableFiles.length === 0) return true; // Gruplarda seçilecek dosya yoksa, "seçilmiş" kabul edilir.
          return selectableFiles.every(file => group.selection.has(file));
      });
  }, [filteredDuplicateGroups]);

    const handlePlayPause = async (filePath: string) => {
        if (currentlyPlaying?.path === filePath) {
            if (audioRef.current) {
                if (audioRef.current.paused) {
                    audioRef.current.play();
                } else {
                    audioRef.current.pause();
                }
            }
        } else {
            if (currentlyPlaying) {
                URL.revokeObjectURL(currentlyPlaying.url);
            }
            
            const file = fileObjects.get(filePath);
            if (file) {
                const url = URL.createObjectURL(file);
                setCurrentlyPlaying({ path: filePath, url });
            } else {
                const appFile = files.find(f => f.path === filePath);
                if(appFile) {
                    try {
                        const fileBlob = await appFile.handle.getFile();
                        const newFileObjects = new Map(fileObjects);
                        newFileObjects.set(filePath, fileBlob);
                        setFileObjects(newFileObjects);
                        const url = URL.createObjectURL(fileBlob);
                        setCurrentlyPlaying({ path: filePath, url });
                    } catch (e) {
                         toast({ title: "Oynatma Hatası", description: "Dosya okunurken bir hata oluştu.", variant: "destructive" });
                    }
                }
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

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.key === 'Delete' || event.key === 'Backspace') && activeFolderCard) {
                event.preventDefault();
                removeFolder(activeFolderCard);
                setActiveFolderCard(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeFolderCard, removeFolder]);
    
    useEffect(() => {
      const mainEl = mainContentRef.current;
      const handleScroll = () => {
        if (mainEl) {
          setShowScrollTop(mainEl.scrollTop > 300);
        }
      };
      
      mainEl?.addEventListener('scroll', handleScroll);
      return () => mainEl?.removeEventListener('scroll', handleScroll);
    }, []);

    const scrollToTop = () => {
        mainContentRef.current?.scrollTo({
            top: 0,
            behavior: 'smooth',
        });
    };

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
                    filesWithMetaData.sort((a, b) => b.bitrate - a.bitrate || b.size - a.size);
                    break;
                case 'keep_lowest_quality':
                     filesWithMetaData.sort((a, b) => a.bitrate - b.bitrate || a.size - b.size);
                    break;
                case 'keep_shortest_name':
                    filesWithMetaData.sort((a, b) => a.name.length - b.name.length);
                    break;
                default:
                    return group;
            }
            
            fileToKeep = filesWithMetaData.length > 0 ? filesWithMetaData[0].path : '';
            
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

  const renderFileSelectionView = () => (
    <div className="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle>Analize Hazır Klasörler</CardTitle>
                <CardDescription>
                    Aşağıda analize dahil edilecek klasörler listelenmiştir.
                    Toplam {files.length} dosya bulundu. Analizi başlatmaya hazırsınız.
                </CardDescription>
            </CardHeader>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedFoldersWithCounts.map(({ path, count }) => (
                <Card 
                    key={path}
                    className={cn(
                        "group relative cursor-pointer transition-all hover:shadow-lg hover:-translate-y-1",
                        activeFolderCard === path && "ring-2 ring-primary shadow-lg -translate-y-1"
                    )}
                    onClick={() => setActiveFolderCard(path)}
                    tabIndex={0}
                    onBlur={() => setActiveFolderCard(null)}
                >
                    <CardHeader className="flex flex-row items-start gap-4">
                       <Folder className="h-10 w-10 text-primary flex-shrink-0 mt-1" />
                       <div className="flex-1 overflow-hidden">
                           <CardTitle className="text-lg truncate" title={path}>{path.split('/').pop() || path}</CardTitle>
                           <CardDescription className="truncate text-xs" title={path}>{path}</CardDescription>
                       </div>
                    </CardHeader>
                    <CardContent>
                       <Badge variant="secondary">{count} dosya</Badge>
                    </CardContent>
                    <Button 
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                          e.stopPropagation();
                          removeFolder(path);
                      }}
                    >
                      <XCircle className="h-5 w-5 text-muted-foreground hover:text-destructive" />
                    </Button>
                </Card>
            ))}
        </div>
    </div>
  );


  const renderResultsView = () => {
    if (filteredDuplicateGroups.length === 0 && analysisStats) {
      return (
        <Card className="shadow-lg w-full max-w-lg mx-auto">
            <CardHeader>
                <CardTitle>Analiz Tamamlandı</CardTitle>
            </CardHeader>
            <CardContent className="p-6 text-center">
              <FileScan className="h-20 w-20 text-primary mx-auto mb-6" />
              <p className="text-muted-foreground">{filterText || excludeFilterText ? 'Arama kriterlerinize uyan kopya bulunamadı.' : 'Tebrikler! Müzik kütüphanenizde yinelenen dosya bulunamadı.'}</p>
              <div className="mt-6 flex justify-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <Timer className="h-4 w-4" />
                        <span>{analysisStats.duration.toFixed(2)} saniye</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <FileDigit className="h-4 w-4" />
                        <span>{analysisStats.scannedFiles} dosya</span>
                    </div>
                </div>
            </CardContent>
        </Card>
      );
    }

    return (
        <div className="space-y-6">
             {analysisStats && (
                <Card>
                    <CardHeader>
                         <CardTitle>Analiz Sonuçları</CardTitle>
                         <CardDescription>
                            Tarama {analysisStats.duration.toFixed(2)} saniye sürdü. Toplam {analysisStats.scannedFiles} dosya içinde {analysisStats.foundGroups} yinelenen grup bulundu.
                         </CardDescription>
                    </CardHeader>
                </Card>
             )}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                    <div className='flex items-center gap-2 flex-wrap'>
                       <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline">
                              <SortDesc className="mr-2" />
                              {sortOptions[sortOption]}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                             {Object.entries(sortOptions).map(([key, value]) => (
                                <DropdownMenuItem key={key} onSelect={() => setSortOption(key as SortOption)}>
                                    {value}
                                </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button variant="outline" onClick={() => handleSelectAll(!areAllSelected)}>
                            {areAllSelected ? <X className="mr-2"/> : <CheckCheck className="mr-2"/>}
                            {areAllSelected ? 'Tüm Seçimi Bırak' : 'Tümünü Seç'}
                        </Button>
                    </div>
                     <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" disabled={totalSelectedCount === 0 || isPending}>
                             <Trash2 className="mr-2" /> Tüm Seçilenleri Sil ({totalSelectedCount})
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
                             <div className='flex items-center gap-2'>
                               <Badge variant={group.similarityScore > 0.9 ? 'default' : 'secondary'}>
                                  Benzerlik: {Math.round(group.similarityScore * 100)}%
                               </Badge>
                               <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            disabled={group.selection.size === 0}
                                            onClick={(e) => e.stopPropagation()} // Akordiyonu aç/kapatmayı engelle
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" /> Sil ({group.selection.size})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Bu Gruptaki Seçili Dosyaları Sil?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                Bu işlem seçili {group.selection.size} dosyayı kalıcı olarak silecektir. Bu eylem geri alınamaz.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>İptal</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteSelected([group])} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Evet, Sil</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                             </div>
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
                    <Button variant="outline" onClick={cancelAnalysis} className="mt-6">
                        <XCircle className="mr-2"/>
                        İptal Et
                    </Button>
                  </div>
                </CardContent>
            </Card>
       );
    }
    
    if (viewState === 'results' ) {
      return renderResultsView();
    }
    
    if (viewState === 'files_selected' && files.length > 0) {
      return renderFileSelectionView();
    }
    
    return renderInitialView();
  };
  
  return (
    <SidebarProvider>
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
        <div ref={mainContentRef} className="flex-1 overflow-auto">
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
        
        {showScrollTop && (
             <Button
                variant="outline"
                size="icon"
                className="fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-2xl z-50 bg-background/80 backdrop-blur-sm"
                onClick={scrollToTop}
            >
                <ArrowUpCircle className="h-6 w-6" />
            </Button>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
