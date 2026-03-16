import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Login } from './pages/login/login';
import { Dashboard } from './pages/dashboard/dashboard';
import { Terminal } from './pages/terminal/terminal';
import { AiChat } from './pages/ai-chat/ai-chat';
import { Files } from './pages/files/files';
import { Shell } from './shell/shell';
import { authGuard } from './guards/auth-guard';

const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: Dashboard },
      { path: 'terminal',  component: Terminal  },
      { path: 'files',     component: Files     },
      { path: 'ai',        component: AiChat    },
      { path: '',          redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '/dashboard' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
