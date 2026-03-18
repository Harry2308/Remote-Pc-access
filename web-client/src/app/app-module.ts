import { NgModule, provideBrowserGlobalErrorListeners } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { LayoutModule } from '@angular/cdk/layout';

// Angular Material
import { MatToolbarModule }        from '@angular/material/toolbar';
import { MatSidenavModule }        from '@angular/material/sidenav';
import { MatListModule }           from '@angular/material/list';
import { MatButtonModule }         from '@angular/material/button';
import { MatCardModule }           from '@angular/material/card';
import { MatFormFieldModule }      from '@angular/material/form-field';
import { MatInputModule }          from '@angular/material/input';
import { MatIconModule }           from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule }       from '@angular/material/snack-bar';
import { MatChipsModule }          from '@angular/material/chips';
import { MatDividerModule }        from '@angular/material/divider';
import { MatProgressBarModule }    from '@angular/material/progress-bar';
import { MatSelectModule }         from '@angular/material/select';
import { MatTooltipModule }        from '@angular/material/tooltip';
import { MatTableModule }          from '@angular/material/table';
import { MatMenuModule }           from '@angular/material/menu';
import { MatDialogModule }         from '@angular/material/dialog';

import { AppRoutingModule } from './app-routing-module';
import { App }        from './app';
import { Shell }      from './shell/shell';
import { Login }      from './pages/login/login';
import { Dashboard }  from './pages/dashboard/dashboard';
import { Terminal }   from './pages/terminal/terminal';
import { AiChat }     from './pages/ai-chat/ai-chat';
import { Files }      from './pages/files/files';
import { Screen }     from './pages/screen/screen';
import { Processes }  from './pages/processes/processes';
import { AuthInterceptor } from './interceptors/auth.interceptor';

@NgModule({
  declarations: [App, Shell, Login, Dashboard, Terminal, AiChat, Files, Screen, Processes],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    ReactiveFormsModule,
    FormsModule,
    HttpClientModule,
    LayoutModule,
    AppRoutingModule,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatChipsModule,
    MatDividerModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
    MatTableModule,
    MatMenuModule,
    MatDialogModule,
  ],
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
  ],
  bootstrap: [App],
})
export class AppModule {}
