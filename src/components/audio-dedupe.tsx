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
import { findDuplicateGroupsLocally } from '@/lib/local-analyzer';
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
const ANALYSIS_CHUNK_SIZE = 100; // Process 100 files at a time to avoid blocking UI
const RESULTS_PAGE_SIZE = 50;

type ViewState = 'initial' | 'files_selected' | 'analyzing' | 'results';
type SelectionStrategy = 'none' | 'keep_highest_quality' | 'keep_lowest_quality' | 'keep_shortest_name';


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
  const analysisStateRef = useRef({ isRunning: false });
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
    event.target.value = '';
  };
  
  const readMetadata = (file: File): Promise<FileWithMetadata> => {
      return new Promise((resolve) => {
        jsmediatags.read(file, {
            onSuccess: (tag) => {
                const v2 = (tag.tags as any).v2;
                resolve({
                    path: (file as any).webkitRelativePath || file.name,
                    size: file.size,
                    bitrate: v2 && v2.TLEN ? v2.TLEN / 8192 : 0, // Simplified bitrate estimation
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
    analysisStateRef.current.isRunning = true;
    
    setLoadingMessage('Meta veriler okunuyor...');
    const metadataMap = new Map<string, FileWithMetadata>();
    const filesToRead = Array.from(fileObjects.values());
    for (let i = 0; i < filesToRead.length; i++) {
        const file = filesToRead[i];
        const path = (file as any).webkitRelativePath || file.name;
        if (!filesWithMetadata.has(path)) {
            const meta = await readMetadata(file);
            metadataMap.set(path, meta);
        } else {
            metadataMap.set(path, filesWithMetadata.get(path)!);
        }
        setAnalysisProgress((i / filesToRead.length) * 100);
    }
    setFilesWithMetadata(metadataMap);

    const allFilePaths = files.map(f => f.path);
    let processedCount = 0;
    const allGroups: DuplicateGroup[] = [];
    let groupIndex = 0;

    const processChunk = (startIndex: number) => {
        if (!analysisStateRef.current.isRunning) {
            console.log("Analysis cancelled.");
            return;
        }

        const endIndex = Math.min(startIndex + ANALYSIS_CHUNK_SIZE, allFilePaths.length);
        const chunk = allFilePaths.slice(startIndex, endIndex);

        try {
            const chunkResult = findDuplicateGroupsLocally(chunk, similarityThreshold, allFilePaths.slice(0, startIndex));
            
            if (chunkResult.length > 0) {
              allGroups.push(...chunkResult);
            }

            processedCount = endIndex;
            const progress = (processedCount / allFilePaths.length) * 100;
            setAnalysisProgress(progress);
            setLoadingMessage(`${processedCount} / ${allFilePaths.length} dosya analiz edildi...`);

            if (endIndex < allFilePaths.length) {
                setTimeout(() => processChunk(endIndex), 0);
            } else {
                const groupsWithSelection = allGroups
                    .map((group) => ({
                        ...group,
                        id: `group-${groupIndex++}`,
                        selection: new Set(group.files.slice(1)),
                    }))
                    .sort((a, b) => b.similarityScore - a.similarityScore);
                
                setDuplicateGroups(groupsWithSelection);
                setResultsSimilarityFilter(similarityThreshold);
                
                const initiallyOpen = groupsWithSelection
                    .filter(g => g.files.length === 2)
                    .map(g => g.id);
                setOpenAccordionItems(initiallyOpen);
                
                if (groupsWithSelection.length === 0) {
                    toast({ title: "Kopya bulunamadı", description: "Analiz tamamlandı ancak yinelenen grup tespit edilmedi." });
                } else {
                    toast({ title: "Analiz Tamamlandı", description: `${groupsWithSelection.length} yinelenen grup bulundu.` });
                }

                setViewState('results');
                setLoadingMessage('');
                analysisStateRef.current.isRunning = false;
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Analiz sırasında beklenmedik bir hata oluştu.';
            setError(errorMessage);
            toast({ title: "Analiz Hatası", description: errorMessage, variant: "destructive" });
            setViewState('results');
            setLoadingMessage('');
            analysisStateRef.current.isRunning = false;
        }
    };
    
    setLoadingMessage(`0 / ${allFilePaths.length} dosya analiz edildi...`);
    setTimeout(() => processChunk(0), 100);
  };

  useEffect(() => {
    return () => {
        analysisStateRef.current.isRunning = false;
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

  const handleDeleteSelected = async (groupsToDeleteFrom: DuplicateGroupWithSelection[]) => {
    toast({
        title: "Silme işlemi uygulanamadı",
        description: "Bu klasör seçim yöntemiyle dosya silme desteklenmiyor.",
        variant: "destructive",
    });
    console.warn("File deletion was attempted, but it is not implemented for the input[type=file] method. The original implementation used showDirectoryPicker which has write access.");
  };
  
  const clearAllFiles = () => {
    analysisStateRef.current.isRunning = false;
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
        let currentPath = '';
        for (let i = 0; i < pathParts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i];
          folderSet.add(currentPath);
        }
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
      filtered = filtered.filter(group =>
        group.files.some(file =>
          file.toLowerCase().includes(filterText.toLowerCase())
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
            const file = fileObjects.get(filePath);
            if (file) {
                if (currentlyPlaying) {
                    URL.revokeObjectURL(currentlyPlaying.url);
                }
                const url = URL.createObjectURL(file);
                setCurrentlyPlaying({ path: filePath, url });
            }
        }
    };
    
    useEffect(() => {
        if (currentlyPlaying && audioRef.current) {
            audioRef.current.src = currentlyPlaying.url;
            audioRef.current.play().catch(e => console.error("Audio play failed:", e));
            setIsPlaying(true);
        } else {
            setIsPlaying(false);
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
            <p className="text-muted-foreground mb-6">Yinelenen ses dosyalarını bulmak için müzik klasör(ler)inizi seçin. Yerel, hızlı ve güvenli.</p>
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
                     <Button variant="ghost" size="icon" onClick={() => setCurrentlyPlaying(null)}>
                        <XCircle className="h-5 w-5"/>
                    </Button>
                </div>
                 <audio 
                    ref={audioRef}
                    onEnded={() => setCurrentlyPlaying(null)}
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    className="w-full mt-2"
                    controls
                    hidden
                />
            </Card>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
