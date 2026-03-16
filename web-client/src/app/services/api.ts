import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface StatusResponse {
  agentConnected: boolean;
  timestamp: string;
}

export interface MessageResponse {
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = `${environment.apiUrl}/api`;

  constructor(private http: HttpClient) {}

  getStatus(): Observable<StatusResponse> {
    return this.http.get<StatusResponse>(`${this.base}/status`);
  }

  wake(): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/power/wake`, {});
  }

  sleep(): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/power/sleep`, {});
  }

  shutdown(): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/power/shutdown`, {});
  }

  restart(): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/power/restart`, {});
  }

  launchApp(name: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/apps/launch`, { name });
  }
}
