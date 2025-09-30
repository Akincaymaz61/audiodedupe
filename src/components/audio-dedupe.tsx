'use client';

import { useState, useMemo, useCallback, useTransition, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { FolderSearch, FileScan, Trash2, Loader2, Music2, Folder, AlertTriangle, Info, FolderPlus } from 'lucide-react';
import type { AppFile, DuplicateGroupWithSelection } from '@/lib/types';
import { Logo } from './logo';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';

const AUDIO_EXTENSIONS = /\.(mp3|wav|flac|m4a|ogg|aac|aiff)$/i;

export default function AudioDedupe() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroupWithSelection[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analysisRan, setAnalysisRan] = useState(false);

  const { toast } = useToast();

  const handleSelectDirectoryClick = () => {
    fileInputRef.current?.click();
  };

  const processFiles = useCallback((selectedFiles: FileList) => {
    setError(null);

    startTransition(() => {
        setLoadingMessage('Ses dosyaları aranıyor...');
        const newFiles: AppFile[] = [];
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            if (AUDIO_EXTENSIONS.test(file.name) && file.webkitRelativePath) {
              const filePath = file.webkitRelativePath;
              // Sadece daha önce eklenmemiş dosyaları ekle
              if (!files.some(f => f.path === filePath) && !newFiles.some(f => f.path === filePath)) {
                newFiles.push({
                    handle: { name: file.name, kind: 'file', remove: async () => { console.error("Deletion not implemented for this file handle type.") } } as unknown as FileSystemFileHandle,
                    parentHandle: { name: '', kind: 'directory' } as unknown as FileSystemDirectoryHandle,
                    name: file.name,
                    path: file.webkitRelativePath,
                });
              }
            }
        }

        if (newFiles.length > 0) {
          setFiles(prevFiles => [...prevFiles, ...newFiles].sort((a,b) => a.path.localeCompare(b.path)));
          setDuplicateGroups([]);
          setAnalysisRan(false);
        }
        
        setLoadingMessage('');

        if (files.length + newFiles.length === 0) {
            setError("Seçilen dizinde ses dosyası bulunamadı.");
        }
    });
  }, [files]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
        processFiles(selectedFiles);
    }
    event.target.value = '';
  };


  const handleAnalyze = () => {
    if (files.length === 0) {
      setError('Analiz edilecek dosya yok. Lütfen önce bir klasör seçin.');
      return;
    }
    
    startTransition(() => {
      setAnalysisRan(true);
      setLoadingMessage('Dosyalar analiz ediliyor... Bu işlem yerel olarak yapılıyor ve büyük kütüphanelerde zaman alabilir.');
      setError(null);
      try {
        const filePaths = files.map(f => f.path);
        const result = findDuplicateGroupsLocally(filePaths);

        const groupsWithSelection = result
          .filter(g => g.files.length > 1)
          .map((group, index) => {
            const selection = new Set(group.files.slice(1));
            return { ...group, id: `group-${index}`, selection };
          });

        setDuplicateGroups(groupsWithSelection);
        if (groupsWithSelection.length === 0) {
            toast({ title: "Kopya bulunamadı", description: "Yerel analiz tamamlandı ancak yinelenen grup tespit edilmedi." });
        }
      } catch (e) {
          if (e instanceof Error) {
            setError(e.message);
          } else {
            setError('Analiz sırasında beklenmedik bir hata oluştu.');
          }
      } finally {
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

  const handleDeleteSelected = async (groupsToDeleteFrom: DuplicateGroupWithSelection[]) => {
    toast({
        title: "Silme işlemi uygulanamadı",
        description: "Bu klasör seçim yöntemiyle dosya silme desteklenmiyor.",
        variant: "destructive",
    });
    console.warn("File deletion was attempted, but it is not implemented for the input[type=file] method. The original implementation used showDirectoryPicker which has write access.");
  };

  const totalSelectedCount = useMemo(() => {
    return duplicateGroups.reduce((acc, group) => acc + group.selection.size, 0);
  }, [duplicateGroups]);
  
  const renderLoading = () => (
    <div className="flex flex-col items-center justify-center text-center p-10 h-64">
      <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
      <p className="text-lg font-semibold">{loadingMessage}</p>
      <p className="text-muted-foreground">Lütfen bekleyin...</p>
    </div>
  );

  const renderContent = () => {
    if (isPending) return renderLoading();

    if (analysisRan && !error && duplicateGroups.length > 0) {
      return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Kopyaları İncele</h2>
                    <p className="text-muted-foreground">{duplicateGroups.length} grup benzer ses dosyası bulundu.</p>
                </div>
                 <div className="flex gap-2">
                    <Button variant="outline" onClick={handleSelectDirectoryClick}>
                        <FolderPlus className="mr-2 h-4 w-4" />
                        Daha Fazla Klasör Ekle
                    </Button>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                           <Button variant="destructive" disabled={totalSelectedCount === 0 || isPending}>
                             <Trash2 className="mr-2 h-4 w-4" /> Seçilenlerin Tümünü Sil ({totalSelectedCount})
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
                                <AlertDialogAction onClick={() => handleDeleteSelected(duplicateGroups)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Sil</AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </header>
            <Accordion type="multiple" className="w-full">
            {duplicateGroups.map(group => (
              <Card key={group.id} className="mb-4 overflow-hidden">
                <AccordionItem value={group.id} className="border-b-0">
                  <AccordionTrigger className="p-4 hover:no-underline hover:bg-muted/50">
                    <div className="flex-1 text-left">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-lg">{group.files.length} benzer dosya bulundu</p>
                        {typeof group.similarityScore === 'number' && (
                           <Badge variant="secondary">Benzerlik: {Math.round(group.similarityScore * 100)}%</Badge>
                        )}
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground mt-1">
                        <Info className="w-4 h-4 mr-2"/>
                        <span className="font-mono text-xs">{group.reason}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-0">
                    <div className="border-t">
                      <ScrollArea className="h-full max-h-[300px]">
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
                                    <label htmlFor={`${group.id}-${filePath}`} className="font-medium flex items-center gap-2 cursor-pointer truncate">
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
                      </ScrollArea>
                      <div className="p-4 border-t bg-muted/30 flex justify-end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={group.selection.size === 0 || isPending}>
                              <Trash2 className="mr-2 h-4 w-4" /> Bu gruptaki seçilileri sil ({group.selection.size})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Emin misiniz?</AlertDialogTitle>
                                <AlertDialogDescription>
                                   Bu gruptaki {group.selection.size} dosyayı kalıcı olarak silecektir. Bu eylem geri alınamaz.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>İptal</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteSelected([group])} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Sil</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Card>
            ))}
          </Accordion>
        </div>
      );
    }
    
    // This now handles analysisRan && (error || duplicateGroups.length === 0)
    if (analysisRan) {
         return (
            <div className="text-center p-10">
              <FileScan className="h-16 w-16 text-primary mx-auto mb-4" />
              <h2 className="text-2xl font-bold">Analiz Tamamlandı</h2>
              <p className="text-muted-foreground mb-6">Yinelenen dosya bulunamadı veya analiz sırasında bir sorun oluştu. Başka bir klasör ekleyebilir veya yeniden analiz edebilirsiniz.</p>
              <div className="flex justify-center gap-4">
                <Button size="lg" onClick={handleAnalyze} disabled={isPending}>
                    <FileScan className="mr-2 h-5 w-5" />
                    Tekrar Analiz Et
                </Button>
                <Button size="lg" variant="outline" onClick={handleSelectDirectoryClick} disabled={isPending}>
                    <FolderPlus className="mr-2 h-5 w-5" />
                    Daha Fazla Klasör Ekle
                </Button>
              </div>
            </div>
          );
    }
    
    if (files.length > 0) {
      return (
        <div className="text-center p-10">
          <FileScan className="h-16 w-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Tarama tamamlandı</h2>
          <p className="text-muted-foreground mb-6">{files.length} ses dosyası bulundu. Kopya analizi için hazır.</p>
          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={handleAnalyze} disabled={isPending}>
                <FileScan className="mr-2 h-5 w-5" />
                Kopyaları Analiz Et
            </Button>
            <Button size="lg" variant="outline" onClick={handleSelectDirectoryClick} disabled={isPending}>
                <FolderPlus className="mr-2 h-5 w-5" />
                Daha Fazla Klasör Ekle
            </Button>
          </div>
        </div>
      );
    }
    
    return (
      <div className="text-center p-10">
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileSelect}
          webkitdirectory="true"
          mozdirectory="true"
          multiple
        />
        <FolderSearch className="h-16 w-16 text-primary mx-auto mb-4" />
        <h2 className="text-2xl font-bold">Bir klasör tarayarak başlayın</h2>
        <p className="text-muted-foreground mb-6">Yinelenen ses dosyalarını bulmak için ana müzik dizininizi seçin.</p>
        <Button size="lg" onClick={handleSelectDirectoryClick} disabled={isPending}>
          <FolderSearch className="mr-2 h-5 w-5" />
          Müzik Klasörünü Seç
        </Button>
      </div>
    );
  };
  
  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2 pt-8">
        <Logo />
        <p className="text-muted-foreground">
        Kütüphanenizdeki yinelenen ses dosyalarını yerel olarak bulun ve kaldırın.
        </p>
      </header>
      <main className="w-full">
        <Card className="w-full shadow-lg">
            <CardContent className="p-6">
                {error && (
                    <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold">Bir hata oluştu</p>
                            <p className="text-sm">{error}</p>
                        </div>
                    </div>
                )}
                {renderContent()}
            </CardContent>
        </Card>
        <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Audio Dedupe. Kütüphanenizi temizleyin, müziğinizin keyfini çıkarın.</p>
        </footer>
      </main>
    </div>
  );
}
