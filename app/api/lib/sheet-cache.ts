// app/api/lib/sheet-cache.ts
// Smart caching for Google Sheets data using modification time checks

import { getFileModifiedTime, extractFileId } from "./google-drive";

interface CacheEntry<T> {
    data: T;
    modifiedTime: string;
    cachedAt: number;
}

// In-memory cache for sheet data
const SHEET_CACHE = new Map<string, CacheEntry<any>>();

// Maximum age before we force a mod time check (even if cached)
const MAX_CACHE_AGE = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached data for a sheet, checking modification time for freshness
 *
 * Flow:
 * 1. If no cache -> return null (caller should fetch fresh)
 * 2. If cache is very fresh (< 30s) -> return cached without checking
 * 3. Check modification time against cached version
 * 4. If unchanged -> return cached data
 * 5. If changed -> return null (caller should fetch fresh)
 *
 * @param sheetUrl - The Google Sheets URL
 * @returns Cached data if still valid, null if needs refresh
 */
export async function getCachedSheetData<T>(sheetUrl: string): Promise<T | null> {
    const fileId = extractFileId(sheetUrl);
    if (!fileId) return null;

    const cached = SHEET_CACHE.get(fileId);
    if (!cached) return null;

    const age = Date.now() - cached.cachedAt;

    // If cache is very fresh, skip the mod time check
    if (age < 30 * 1000) {
        return cached.data;
    }

    // If cache is too old, force refresh
    if (age > MAX_CACHE_AGE) {
        return null;
    }

    // Check if file was modified since we cached it
    const currentModTime = await getFileModifiedTime(fileId);

    if (currentModTime && currentModTime === cached.modifiedTime) {
        // File hasn't changed, return cached data
        // Update cachedAt to extend the "very fresh" window
        cached.cachedAt = Date.now();
        return cached.data;
    }

    // File was modified or couldn't check, return null to trigger refresh
    return null;
}

/**
 * Store data in cache with its modification time
 *
 * @param sheetUrl - The Google Sheets URL
 * @param data - The data to cache
 * @param modifiedTime - Optional modification time (will be fetched if not provided)
 */
export async function setCachedSheetData<T>(
    sheetUrl: string,
    data: T,
    modifiedTime?: string
): Promise<void> {
    const fileId = extractFileId(sheetUrl);
    if (!fileId) return;

    // Get modification time if not provided
    const modTime = modifiedTime || await getFileModifiedTime(fileId);
    if (!modTime) {
        // Can't get mod time, still cache but with shorter effective TTL
    }

    SHEET_CACHE.set(fileId, {
        data,
        modifiedTime: modTime || "",
        cachedAt: Date.now(),
    });
}

/**
 * Invalidate cache for a specific sheet
 */
export function invalidateSheetCache(sheetUrl: string): void {
    const fileId = extractFileId(sheetUrl);
    if (fileId) {
        SHEET_CACHE.delete(fileId);
    }
}

/**
 * Invalidate all cached sheet data
 */
export function invalidateAllSheetCache(): void {
    SHEET_CACHE.clear();
}

/**
 * Get cache stats for debugging
 */
export function getSheetCacheStats(): { size: number; entries: string[] } {
    return {
        size: SHEET_CACHE.size,
        entries: Array.from(SHEET_CACHE.keys()),
    };
}
