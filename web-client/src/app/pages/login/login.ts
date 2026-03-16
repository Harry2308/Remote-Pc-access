import { Component, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  form: FormGroup;
  loading = false;
  hidePassword = true;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });

    if (this.auth.isLoggedIn) {
      this.router.navigate(['/dashboard']);
    }
  }

  submit(): void {
    if (this.form.invalid || this.loading) return;

    this.loading = true;
    const { username, password } = this.form.value;

    this.auth.login(username, password).subscribe({
      next: () => {
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        this.loading = false;
        this.cdr.detectChanges();
        const msg = err?.error?.error || 'Login failed';
        this.snackBar.open(msg, 'Close', { duration: 4000 });
      },
    });
  }
}
