'use server';

import { autoGroupDuplicates } from '@/ai/flows/auto-group-duplicates';
import type { AutoGroupDuplicatesInput, AutoGroupDuplicatesOutput } from '@/ai/flows/auto-group-duplicates';

const BATCH_SIZE = 1000; // Tek seferde AI'ye gönderilecek dosya sayısı

export async function findDuplicateFiles(input: AutoGroupDuplicatesInput) {
    try {
        const fileList = input.fileList;
        const batches = [];
        for (let i = 0; i < fileList.length; i += BATCH_SIZE) {
            batches.push(fileList.slice(i, i + BATCH_SIZE));
        }

        let allDuplicateGroups: AutoGroupDuplicatesOutput['duplicateGroups'] = [];

        for (const batch of batches) {
            const batchInput: AutoGroupDuplicatesInput = { fileList: batch };
            const result = await autoGroupDuplicates(batchInput);
            if (result.duplicateGroups) {
                allDuplicateGroups = allDuplicateGroups.concat(result.duplicateGroups);
            }
        }
        
        // Grupları birleştirme ve yeniden işleme (isteğe bağlı, şimdilik basit birleştirme)
        // Burada, farklı kümelerden gelen grupları daha akıllıca birleştirecek ek mantık eklenebilir.
        // Şimdilik, sadece tüm grupları birleştiriyoruz.

        return { success: true, data: { duplicateGroups: allDuplicateGroups } };

    } catch (error) {
        console.error("AI analysis failed:", error);
        const errorMessage = error instanceof Error ? error.message : "Yapay zeka analizi sırasında bilinmeyen bir hata oluştu.";
        return { success: false, error: `Yapay zeka analizi başarısız oldu. Lütfen tekrar deneyin. Detaylar: ${errorMessage}` };
    }
}
