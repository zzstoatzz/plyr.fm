// global logout modal state using Svelte 5 runes
import type { User, LinkedAccount } from '$lib/types';

class LogoutState {
	isOpen = $state(false);
	user: User | null = $state(null);
	otherAccounts: LinkedAccount[] = $state([]);
	onLogoutAll: (() => Promise<void>) | null = null;
	onLogoutAndSwitch: ((account: LinkedAccount) => Promise<void>) | null = null;

	open(
		user: User | null,
		otherAccounts: LinkedAccount[],
		onLogoutAll: () => Promise<void>,
		onLogoutAndSwitch: (account: LinkedAccount) => Promise<void>
	) {
		this.user = user;
		this.otherAccounts = otherAccounts;
		this.onLogoutAll = onLogoutAll;
		this.onLogoutAndSwitch = onLogoutAndSwitch;
		this.isOpen = true;
	}

	close() {
		this.isOpen = false;
	}

	async logoutAll() {
		if (this.onLogoutAll) {
			this.close();
			await this.onLogoutAll();
		}
	}

	async logoutAndSwitch(account: LinkedAccount) {
		if (this.onLogoutAndSwitch) {
			this.close();
			await this.onLogoutAndSwitch(account);
		}
	}
}

export const logout = new LogoutState();
