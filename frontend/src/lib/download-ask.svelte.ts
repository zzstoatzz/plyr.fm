// global state for the download support-ask interstitial.
// an "ask"-policy download opens this modal: one support link, one continue.

class DownloadAskState {
	isOpen = $state(false);
	artistName = $state('');
	supportHref = $state('');
	private onContinue: (() => void) | null = null;

	open(artistName: string, supportHref: string, onContinue: () => void): void {
		this.artistName = artistName;
		this.supportHref = supportHref;
		this.onContinue = onContinue;
		this.isOpen = true;
	}

	continueDownload(): void {
		const proceed = this.onContinue;
		this.close();
		proceed?.();
	}

	close(): void {
		this.isOpen = false;
		this.onContinue = null;
	}
}

export const downloadAsk = new DownloadAskState();
