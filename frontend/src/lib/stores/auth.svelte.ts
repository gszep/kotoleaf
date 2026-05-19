import { browser } from '$app/environment';

interface User {
	id: string;
	email: string;
	name: string;
}

interface AuthState {
	token: string | null;
	user: User | null;
}

let auth = $state<AuthState>({
	token: browser ? localStorage.getItem('kotoleaf_token') : null,
	user: null
});

export function getAuth(): AuthState {
	return auth;
}

export function getToken(): string | null {
	return auth.token;
}

export function setAuth(newToken: string, newUser: User): void {
	auth.token = newToken;
	auth.user = newUser;
	if (browser) {
		localStorage.setItem('kotoleaf_token', newToken);
	}
}

export function clearAuth(): void {
	auth.token = null;
	auth.user = null;
	if (browser) {
		localStorage.removeItem('kotoleaf_token');
	}
}
