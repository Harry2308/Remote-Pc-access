import { Component, OnInit, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FileService, FileItem, FileListResult } from '../../services/file.service';

@Component({
  selector: 'app-files',
  standalone: false,
  templateUrl: './files.html',
  styleUrl: './files.scss',
})
export class Files implements OnInit {
  @ViewChild('uploadInput') uploadInput!: ElementRef<HTMLInputElement>;

  currentPath = '';
  listing: FileListResult | null = null;
  drives: string[] = [];
  loading = false;
  uploading = false;
  downloadingPath: string | null = null;

  // Inline editing state
  renaming: FileItem | null = null;
  renameValue = '';
  creatingFolder = false;
  newFolderName = '';

  constructor(
    private fileService: FileService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.fileService.getDrives().subscribe({
      next:  (r) => { this.drives = r.drives; this.navigate(r.drives[0] ?? 'D:\\'); },
      error: ()  => this.navigate('D:\\'),
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  navigate(path: string): void {
    if (this.loading) return;
    this.loading = true;
    this.renaming = null;
    this.creatingFolder = false;
    this.fileService.list(path).subscribe({
      next: (r) => {
        this.listing    = r;
        this.currentPath = r.path;
        this.loading    = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.loading = false;
        this.snackBar.open(err?.error?.error || 'Cannot open folder', 'Close', { duration: 4000 });
        this.cdr.detectChanges();
      },
    });
  }

  openItem(item: FileItem): void {
    if (item.isDirectory) {
      this.navigate(item.path);
    }
    // files are handled by the download button — no accidental downloads on click
  }

  goUp(): void {
    if (this.isDriveRoot() || this.loading) return;
    const parts = this.currentPath.replace(/[/\\]+$/, '').split(/[/\\]/);
    if (parts.length <= 1) return;
    parts.pop();
    // Reconstruct: for Windows paths like D:\foo → D:\
    const parent = parts.join('\\') + '\\';
    this.navigate(parent);
  }

  isDriveRoot(): boolean {
    return /^[A-Z]:\\?$/i.test(this.currentPath);
  }

  get breadcrumbs(): { label: string; path: string }[] {
    const parts = this.currentPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
    const crumbs: { label: string; path: string }[] = [];
    let built = '';
    for (const part of parts) {
      built = built ? built + '\\' + part : part;
      crumbs.push({ label: part, path: built + '\\' });
    }
    return crumbs;
  }

  // ── File operations ─────────────────────────────────────────────────────────

  download(item: FileItem, event: Event): void {
    event.stopPropagation();
    this.downloadingPath = item.path;
    this.cdr.detectChanges();
    this.fileService.download(item.path).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = item.name; a.click();
        URL.revokeObjectURL(url);
        this.downloadingPath = null;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.downloadingPath = null;
        this.snackBar.open(err?.error?.error || 'Download failed', 'Close', { duration: 4000 });
        this.cdr.detectChanges();
      },
    });
  }

  deleteItem(item: FileItem, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete "${item.name}"?`)) return;
    this.fileService.delete(item.path).subscribe({
      next: () => { this.snackBar.open('Deleted', 'Close', { duration: 2000 }); this.navigate(this.currentPath); },
      error: (err) => this.snackBar.open(err?.error?.error || 'Delete failed', 'Close', { duration: 4000 }),
    });
  }

  startRename(item: FileItem, event: Event): void {
    event.stopPropagation();
    this.renaming    = item;
    this.renameValue = item.name;
    this.cdr.detectChanges();
  }

  confirmRename(): void {
    if (!this.renaming || !this.renameValue.trim()) { this.renaming = null; return; }
    const newPath = this.currentPath.replace(/[/\\]+$/, '') + '\\' + this.renameValue.trim();
    this.fileService.rename(this.renaming.path, newPath).subscribe({
      next:  () => { this.renaming = null; this.navigate(this.currentPath); },
      error: (err) => { this.renaming = null; this.snackBar.open(err?.error?.error || 'Rename failed', 'Close', { duration: 4000 }); },
    });
  }

  cancelRename(): void { this.renaming = null; }

  startCreateFolder(): void { this.creatingFolder = true; this.newFolderName = ''; }

  confirmCreateFolder(): void {
    if (!this.newFolderName.trim()) { this.creatingFolder = false; return; }
    const newPath = this.currentPath.replace(/[/\\]+$/, '') + '\\' + this.newFolderName.trim();
    this.fileService.mkdir(newPath).subscribe({
      next:  () => { this.creatingFolder = false; this.navigate(this.currentPath); },
      error: (err) => { this.creatingFolder = false; this.snackBar.open(err?.error?.error || 'Create folder failed', 'Close', { duration: 4000 }); },
    });
  }

  cancelCreateFolder(): void { this.creatingFolder = false; }

  triggerUpload(): void { this.uploadInput.nativeElement.click(); }

  onFilesSelected(event: Event): void {
    const files = (event.target as HTMLInputElement).files;
    if (!files?.length) return;
    this.uploading = true;
    let done = 0;
    const total = files.length;
    for (let i = 0; i < total; i++) {
      this.fileService.upload(this.currentPath, files[i]).subscribe({
        next:  () => { if (++done === total) { this.uploading = false; this.navigate(this.currentPath); } },
        error: (err) => { this.uploading = false; this.snackBar.open(err?.error?.error || 'Upload failed', 'Close', { duration: 4000 }); },
      });
    }
    this.uploadInput.nativeElement.value = '';
  }

  refresh(): void { this.navigate(this.currentPath); }

  // ── Display helpers ─────────────────────────────────────────────────────────

  getFileIcon(item: FileItem): string {
    if (item.isDirectory) return 'folder';
    const e = item.extension;
    if (['.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp'].includes(e)) return 'image';
    if (['.mp4','.mkv','.avi','.mov','.wmv'].includes(e))                  return 'movie';
    if (['.mp3','.wav','.flac','.aac','.ogg'].includes(e))                 return 'music_note';
    if (e === '.pdf')                                                        return 'picture_as_pdf';
    if (['.zip','.rar','.7z','.tar','.gz'].includes(e))                    return 'archive';
    if (['.exe','.msi','.bat','.cmd','.ps1'].includes(e))                  return 'terminal';
    if (['.doc','.docx','.odt'].includes(e))                               return 'description';
    if (['.xls','.xlsx','.csv'].includes(e))                               return 'table_chart';
    if (['.ts','.js','.py','.java','.cs','.cpp','.go','.rs'].includes(e))  return 'code';
    if (['.txt','.md','.log'].includes(e))                                 return 'article';
    return 'insert_drive_file';
  }

  getFileIconColor(item: FileItem): string {
    if (item.isDirectory) return '#f9a825';
    const e = item.extension;
    if (['.jpg','.jpeg','.png','.gif','.webp','.svg'].includes(e)) return '#66bb6a';
    if (['.mp4','.mkv','.avi','.mov'].includes(e))                  return '#ab47bc';
    if (['.mp3','.wav','.flac'].includes(e))                        return '#26c6da';
    if (e === '.pdf')                                                return '#ef5350';
    if (['.zip','.rar','.7z'].includes(e))                          return '#ffa726';
    if (['.exe','.msi'].includes(e))                                return '#78909c';
    if (['.ts','.js','.py','.cs'].includes(e))                      return '#42a5f5';
    return '#90a4ae';
  }

  formatSize(bytes: number): string {
    if (!bytes) return '—';
    if (bytes < 1024)             return `${bytes} B`;
    if (bytes < 1048576)          return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824)       return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }

  formatDate(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
