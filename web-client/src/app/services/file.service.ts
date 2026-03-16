import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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
}

@Injectable({ providedIn: 'root' })
export class FileService {
  private base = `${environment.apiUrl}/api/files`;

  constructor(private http: HttpClient) {}

  getDrives(): Observable<{ drives: string[] }> {
    return this.http.get<{ drives: string[] }>(`${this.base}/drives`);
  }

  list(filePath: string): Observable<FileListResult> {
    return this.http.get<FileListResult>(`${this.base}/list`, {
      params: new HttpParams().set('path', filePath),
    });
  }

  download(filePath: string): Observable<Blob> {
    return this.http.get(`${this.base}/download`, {
      params: new HttpParams().set('path', filePath),
      responseType: 'blob',
    });
  }

  delete(filePath: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(this.base, {
      params: new HttpParams().set('path', filePath),
    });
  }

  mkdir(dirPath: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/mkdir`, { path: dirPath });
  }

  rename(from: string, to: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(`${this.base}/rename`, { from, to });
  }

  upload(dirPath: string, file: File): Observable<{ message: string }> {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return this.http.post<{ message: string }>(
      `${this.base}/upload`,
      fd,
      { params: new HttpParams().set('path', dirPath) }
    );
  }
}
