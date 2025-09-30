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
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import { findDuplicateFiles } from '@/app/actions';
import { FolderSearch, FileScan, Trash2, Loader2, Music2, Folder, AlertTriangle, Info } from 'lucide-react';
import type { AppFile, DuplicateGroup, DuplicateGroupWithSelection } from '@/lib/types';
import { Logo } from './logo';
import { ScrollArea } from './ui/scroll-area';

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
    setDuplicateGroups([]);
    setAnalysisRan(false);

    startTransition(() => {
        setLoadingMessage('Audiodateien werden gesucht...');
        const allFiles: AppFile[] = [];
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            if (AUDIO_EXTENSIONS.test(file.name) && file.webkitRelativePath) {
                allFiles.push({
                    handle: { name: file.name, kind: 'file', remove: async () => { console.error("Deletion not implemented for this file handle type.") } } as unknown as FileSystemFileHandle,
                    parentHandle: { name: '', kind: 'directory' } as unknown as FileSystemDirectoryHandle,
                    name: file.name,
                    path: file.webkitRelativePath,
                });
            }
        }

        setFiles(allFiles);
        setLoadingMessage('');

        if (allFiles.length === 0) {
            setError("Im ausgewählten Verzeichnis wurden keine Audiodateien gefunden.");
        }
    });
  }, []);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
        processFiles(selectedFiles);
    }
    event.target.value = '';
  };


  const handleAnalyze = () => {
    if (files.length === 0) {
      setError('Keine Dateien zum Analysieren. Bitte wählen Sie zuerst einen Ordner aus.');
      return;
    }
    setAnalysisRan(true);
    startTransition(async () => {
      setLoadingMessage('Dateien werden mit KI analysiert... Dies kann bei großen Bibliotheken eine Weile dauern.');
      setError(null);
      const input = { fileList: files.map(f => ({ filePath: f.path })) };
      const result = await findDuplicateFiles(input);

      if (result.success && result.data) {
        const groupsWithSelection = result.data.duplicateGroups
          .filter(g => g.files.length > 1)
          .map((group, index) => {
            const selection = new Set(group.files.slice(1));
            return { ...group, id: `group-${index}`, selection };
          });
        setDuplicateGroups(groupsWithSelection);
        if (groupsWithSelection.length === 0) {
            toast({ title: "Keine Duplikate gefunden", description: "Die KI-Analyse wurde abgeschlossen, aber es wurden keine doppelten Gruppen identifiziert." });
        }
      } else {
        setError(result.error || 'Bei der Analyse ist ein unbekannter Fehler aufgetreten.');
      }
      setLoadingMessage('');
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
        title: "Löschen nicht implementiert",
        description: "Das Löschen von Dateien wird mit dieser Ordnere-Auswahlmethode nicht unterstützt.",
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
      <p className="text-muted-foreground">Bitte warten...</p>
    </div>
  );

  const renderContent = () => {
    if (isPending) return renderLoading();

    if (analysisRan && duplicateGroups.length > 0) {
      return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Duplikate überprüfen</h2>
                    <p className="text-muted-foreground">{duplicateGroups.length} Gruppen ähnlicher Audiodateien gefunden.</p>
                </div>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                       <Button variant="destructive" disabled={totalSelectedCount === 0 || isPending}>
                         <Trash2 className="mr-2 h-4 w-4" /> Alle ausgewählten löschen ({totalSelectedCount})
                       </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Sind Sie sich absolut sicher?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Dadurch werden {totalSelectedCount} Datei(en) dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteSelected(duplicateGroups)} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Löschen</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </header>
            <Accordion type="multiple" className="w-full">
            {duplicateGroups.map(group => (
              <Card key={group.id} className="mb-4 overflow-hidden">
                <AccordionItem value={group.id} className="border-b-0">
                  <AccordionTrigger className="p-4 hover:no-underline hover:bg-muted/50">
                    <div className="flex-1 text-left">
                      <p className="font-semibold text-lg">{group.files.length} ähnliche Dateien gefunden</p>
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
                                    aria-label={`Select file ${filePath}`}
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
                              <Trash2 className="mr-2 h-4 w-4" /> Ausgewählte in dieser Gruppe löschen ({group.selection.size})
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Dadurch werden {group.selection.size} Datei(en) aus dieser Gruppe dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteSelected([group])} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">Löschen</AlertDialogAction>
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
    
    if (files.length > 0) {
      return (
        <div className="text-center p-10">
          <FileScan className="h-16 w-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold">Scan abgeschlossen</h2>
          <p className="text-muted-foreground mb-6">{files.length} Audiodateien gefunden. Bereit zur Analyse auf Duplikate.</p>
          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={handleAnalyze} disabled={isPending}>
                <FileScan className="mr-2 h-5 w-5" />
                Auf Duplikate analysieren
            </Button>
            <Button size="lg" variant="outline" onClick={handleSelectDirectoryClick} disabled={isPending}>
                <FolderSearch className="mr-2 h-5 w-5" />
                Einen anderen Ordner auswählen
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
        <h2 className="text-2xl font-bold">Beginnen Sie mit dem Scannen eines Ordners</h2>
        <p className="text-muted-foreground mb-6">Wählen Sie Ihr Hauptmusikverzeichnis aus, um doppelte Audiodateien zu finden.</p>
        <Button size="lg" onClick={handleSelectDirectoryClick} disabled={isPending}>
          <FolderSearch className="mr-2 h-5 w-5" />
          Musikordner auswählen
        </Button>
      </div>
    );
  };
  
  return (
    <div className="flex flex-col items-center w-full max-w-4xl mx-auto space-y-8">
      <header className="text-center space-y-2 pt-8">
        <Logo />
        <p className="text-muted-foreground">
        Finden und entfernen Sie doppelte Audiodateien aus Ihrer Bibliothek mit der Kraft der KI.
        </p>
      </header>
      <main className="w-full">
        <Card className="w-full shadow-lg">
            <CardContent className="p-6">
                {error && (
                    <div className="p-4 mb-4 rounded-md bg-destructive/10 text-destructive border border-destructive/20 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold">Ein Fehler ist aufgetreten</p>
                            <p className="text-sm">{error}</p>
                        </div>
                    </div>
                )}
                {renderContent()}
            </CardContent>
        </Card>
        <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Audio Dedupe. Säubern Sie Ihre Bibliothek, genießen Sie Ihre Musik.</p>
        </footer>
      </main>
    </div>
  );
}
