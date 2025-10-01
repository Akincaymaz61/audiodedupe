'use client';

import { useState, useMemo, useCallback, useTransition, useRef } from 'react';
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
import { FolderSearch, FileScan, Trash2, Loader2, Music2, Folder, AlertTriangle, Info, FolderPlus, Settings, ListMusic, FileX2, FolderX, Search, XCircle } from 'lucide-react';
import type { AppFile, DuplicateGroupWithSelection } from '@/lib/types';
import { Logo } from './logo';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Label } from './ui/label';
import { Slider } from './ui/slider';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|aac|aiff)$/i;

type ViewState = 'initial' | 'files_selected' | 'analyzing' | 'results';

export default function AudioDedupe() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupWithSelection[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewState, setViewState] = useState<ViewState>('initial');
  const [similarityThreshold, setSimilarityThreshold] = useState(0.85);
  const [filterText, setFilterText] = useState('');

  const { toast } = useToast();

  const handleSelectDirectoryClick = () => {
    fileInputRef.current?.click();
  };

  const processFiles = useCallback((selectedFiles: FileList) => {
    setError(null);
    setLoadingMessage('Ses dosyaları taranıyor...');
    setViewState('analyzing');

    startTransition(() => {
        const newFiles: AppFile[] = Array.from(selectedFiles)
          .filter(file => AUDIO_EXTENSIONS.test(file.name) && file.webkitRelativePath)
          .map(file => ({
              handle: { name: file.name, kind: 'file' } as unknown as FileSystemFileHandle,
              parentHandle: { name: '', kind: 'directory' } as unknown as FileSystemDirectoryHandle,
              name: file.name,
              path: file.webkitRelativePath,
          }));

        const uniqueNewFiles = newFiles.filter(nf => !files.some(f => f.path === nf.path));

        if (uniqueNewFiles.length > 0) {
          setFiles(prevFiles => [...prevFiles, ...uniqueNewFiles].sort((a,b) => a.path.localeCompare(b.path)));
        }
        
        setDuplicateGroups([]);
        setViewState('files_selected');
        setLoadingMessage('');

        if (files.length + uniqueNewFiles.length === 0) {
            setError("Seçilen dizinde desteklenen formatta ses dosyası bulunamadı.");
            setViewState('initial');
        } else {
             toast({ title: `${uniqueNewFiles.length} yeni dosya eklendi`, description: `Toplam ${files.length + uniqueNewFiles.length} dosya analize hazır.` });
        }
    });
  }, [files, toast]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
        processFiles(selectedFiles);
    }
    // Reset file input to allow selecting the same folder again
    event.target.value = '';
  };

  const handleAnalyze = () => {
    if (files.length === 0) {
      setError('Analiz edilecek dosya yok. Lütfen önce bir klasör seçin.');
      return;
    }
    
    setViewState('analyzing');
    setLoadingMessage(`Dosyalar analiz ediliyor... Bu işlem yerel olarak yapılıyor ve büyük kütüphanelerde zaman alabilir.`);
    setError(null);
    startTransition(() => {
      try {
        const filePaths = files.map(f => f.path);
        const result = findDuplicateGroupsLocally(filePaths, similarityThreshold);

        const groupsWithSelection = result
          .map((group, index) => ({
            ...group,
            id: `group-${index}`,
            selection: new Set(group.files.slice(1)), // Auto-select all but the first one
          }))
          .sort((a, b) => b.similarityScore - a.similarityScore);

        setDuplicateGroups(groupsWithSelection);
        if (groupsWithSelection.length === 0) {
            toast({ title: "Kopya bulunamadı", description: "Analiz tamamlandı ancak yinelenen grup tespit edilmedi." });
        }
      } catch (e) {
          const errorMessage = e instanceof Error ? e.message : 'Analiz sırasında beklenmedik bir hata oluştu.';
          setError(errorMessage);
          toast({ title: "Analiz Hatası", description: errorMessage, variant: "destructive" });
      } finally {
        setViewState('results');
        setLoadingMessage('');
      }
    });
  };

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
        // Leave the first file unselected
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
    setFiles([]);
    setDuplicateGroups([]);
    setError(null);
    setViewState('initial');
    toast({title: "Liste Temizlendi", description: "Tüm dosyalar listeden kaldırıldı."})
  }

  const removeFolder = (folderPath: string) => {
    const newFiles = files.filter(file => !file.path.startsWith(folderPath + '/'));
    setFiles(newFiles);
    setDuplicateGroups([]);
    setViewState(newFiles.length > 0 ? 'files_selected' : 'initial');
    toast({ title: 'Klasör kaldırıldı', description: `${folderPath} klasöründeki tüm dosyalar listeden çıkarıldı.` });
  };
  
  const selectedFolders = useMemo(() => {
    const folderSet = new Set<string>();
    files.forEach(file => {
      const parts = file.path.split('/');
      if (parts.length > 1) {
        folderSet.add(parts[0]);
      }
    });
    return Array.from(folderSet).sort();
  }, [files]);
  
  const filteredDuplicateGroups = useMemo(() => {
    if (!filterText) {
      return duplicateGroups;
    }
    return duplicateGroups.filter(group =>
      group.files.some(file =>
        file.toLowerCase().includes(filterText.toLowerCase())
      )
    );
  }, [duplicateGroups, filterText]);


  const totalSelectedCount = useMemo(() => {
    return duplicateGroups.reduce((acc, group) => acc + group.selection.size, 0);
  }, [duplicateGroups]);
  
  const renderInitialView = () => (
      <Card className="shadow-lg w-full max-w-lg mx-auto">
        <CardContent className="p-10 text-center">
            <div className="flex justify-center mb-6">
              <FolderSearch className="h-20 w-20 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Taramaya Başlayın</h2>
            <p className="text-muted-foreground mb-6">Yinelenen ses dosyalarını bulmak için müzik klasörünüzü seçin. Yerel, hızlı ve güvenli.</p>
            <Button size="lg" onClick={handleSelectDirectoryClick} disabled={isPending}>
              <FolderSearch className="mr-2 h-5 w-5" />
              Müzik Klasörü Seç
            </Button>
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
              <p className="text-muted-foreground">{filterText ? 'Arama kriterlerinize uyan kopya bulunamadı.' : 'Tebrikler! Müzik kütüphanenizde yinelenen dosya bulunamadı.'}</p>
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
                                <AlertDialogAction onClick={() => handleDeleteSelected(duplicateGroups)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Evet, Sil</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </CardHeader>
            </Card>
            <Accordion type="multiple" className="w-full space-y-4">
            {filteredDuplicateGroups.map(group => {
              const isGroupFullySelected = group.selection.size === group.files.length - 1;
              return (
              <Card key={group.id} className="overflow-hidden">
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
                    <div className="border-t">
                      <ul className="p-4 space-y-3">
                        {group.files.map(filePath => {
                          const fileName = filePath.split('/').pop() || filePath;
                          const dirPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
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
        </div>
      );
  }

  const renderContent = () => {
    if (viewState === 'analyzing') {
       return (
            <Card className="shadow-lg w-full max-w-lg mx-auto">
                <CardContent className="p-10 text-center">
                  <div className="flex flex-col items-center justify-center text-center p-10">
                    <Loader2 className="h-16 w-16 animate-spin text-primary mb-6" />
                    <h2 className="text-2xl font-bold mb-2">Analiz Ediliyor</h2>
                    <p className="text-muted-foreground">{loadingMessage}</p>
                  </div>
                </CardContent>
            </Card>
       );
    }
    
    if (viewState === 'results') {
        return renderResultsView();
    }
    
    // Default to initial view if no files are selected
    return renderInitialView();
  };
  
  return (
    <SidebarProvider>
       <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileSelect}
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
                        <Label htmlFor="similarity-threshold">Benzerlik Eşiği: {Math.round(similarityThreshold * 100)}%</Label>
                        <Slider
                          id="similarity-threshold"
                          min={0.5}
                          max={1}
                          step={0.01}
                          value={[similarityThreshold]}
                          onValueChange={(value) => setSimilarityThreshold(value[0])}
                          disabled={isPending || viewState === 'analyzing'}
                        />
                        <p className="text-xs text-muted-foreground">Daha düşük değerler daha fazla kopya bulur, ancak hatalı olabilir.</p>
                      </div>

                     <Button className="w-full" onClick={handleAnalyze} disabled={isPending || files.length === 0 || viewState === 'analyzing'}>
                         <FileScan />
                         Analizi Başlat
                     </Button>
                     
                     {viewState === 'results' && (
                         <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Sonuçları filtrele..."
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
                    <ScrollArea className="h-72 w-full rounded-md border">
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
          <SidebarFooter className='p-4 gap-4'>
            <Button variant="outline" onClick={handleSelectDirectoryClick} disabled={isPending || viewState === 'analyzing'}>
                <FolderPlus />
                Klasör Ekle
            </Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={clearAllFiles} disabled={files.length === 0 || isPending || viewState === 'analyzing'}>
                <FileX2 />
                Listeyi Temizle
            </Button>
          </SidebarFooter>
      </Sidebar>
      <SidebarInset className="max-w-7xl mx-auto p-4 md:p-8">
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
        {renderContent()}

      </SidebarInset>
    </SidebarProvider>
  );
}
