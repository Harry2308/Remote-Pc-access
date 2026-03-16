import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
  extension: string;
}

export interface FileListResult {
  path: string;
  items: FileItem[];
  drives?: string[];
}

export function listDrives(): string[] {
  try {
    return execSync('wmic logicaldisk get name', { timeout: 5000 })
      .toString()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[A-Z]:$/.test(l))
      .map((l) => l + '\\');
  } catch {
    return ['C:\\', 'D:\\'];
  }
}

export function listDirectory(dirPath: string): FileListResult {
  const raw = fs.readdirSync(dirPath);
  const items: FileItem[] = [];

  for (const name of raw) {
    const fullPath = path.join(dirPath, name);
    try {
      const stat = fs.statSync(fullPath);
      items.push({
        name,
        path: fullPath,
        isDirectory: stat.isDirectory(),
        size: stat.isDirectory() ? 0 : stat.size,
        modified: stat.mtime.toISOString(),
        extension: stat.isDirectory() ? '' : path.extname(name).toLowerCase(),
      });
    } catch {
      // Skip inaccessible files
    }
  }

  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return { path: dirPath, items };
}

export function downloadFile(filePath: string): { data: string; name: string; size: number } {
  const data = fs.readFileSync(filePath);
  return {
    data: data.toString('base64'),
    name: path.basename(filePath),
    size: data.length,
  };
}

export function deleteItem(itemPath: string): void {
  const stat = fs.statSync(itemPath);
  if (stat.isDirectory()) {
    fs.rmSync(itemPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(itemPath);
  }
}

export function createDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function renameItem(fromPath: string, toPath: string): void {
  fs.renameSync(fromPath, toPath);
}

export function uploadFile(filePath: string, base64Data: string): void {
  const data = Buffer.from(base64Data, 'base64');
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, data);
}
