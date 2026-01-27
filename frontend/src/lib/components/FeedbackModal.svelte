<script lang="ts">
	import { feedback, REPORT_REASONS, type ReportReason } from '$lib/feedback.svelte';

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			feedback.close();
		}
	}

	function handleSearchInput(event: Event) {
		const target = event.target as HTMLInputElement;
		feedback.setSearchQuery(target.value);
	}

	function handleDescriptionInput(event: Event) {
		const target = event.target as HTMLTextAreaElement;
		feedback.setDescription(target.value);
	}

	function handleReasonChange(event: Event) {
		const target = event.target as HTMLSelectElement;
		feedback.setReason(target.value as ReportReason);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="feedback-backdrop"
	class:open={feedback.isOpen}
	role="presentation"
	onclick={handleBackdropClick}
>
	<div class="feedback-modal" role="dialog" aria-modal="true" aria-label="feedback options">
		<div class="feedback-modal-header">
			<span>feedback</span>
			<button class="close-button" onclick={() => feedback.close()} aria-label="close">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>

		{#if feedback.successMessage}
			<div class="success-message">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
					<polyline points="22 4 12 14.01 9 11.01"></polyline>
				</svg>
				<span>{feedback.successMessage}</span>
			</div>
		{:else}
			<div class="mode-selector">
				<button
					class="mode-button"
					class:active={feedback.mode === 'bug'}
					onclick={() => feedback.setMode('bug')}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M8 2l1.88 1.88"></path>
						<path d="M14.12 3.88L16 2"></path>
						<path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path>
						<path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path>
						<path d="M12 20v-9"></path>
						<path d="M6.53 9C4.6 8.8 3 7.1 3 5"></path>
						<path d="M6 13H2"></path>
						<path d="M3 21c0-2.1 1.7-3.9 3.8-4"></path>
						<path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"></path>
						<path d="M22 13h-4"></path>
						<path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"></path>
					</svg>
					<span>report a bug</span>
				</button>
				<button
					class="mode-button"
					class:active={feedback.mode === 'content'}
					onclick={() => feedback.setMode('content')}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
						<line x1="4" y1="22" x2="4" y2="15"></line>
					</svg>
					<span>report content</span>
				</button>
			</div>

			{#if feedback.mode === 'content'}
				<div class="content-form">
					{#if !feedback.selectedEntity}
						<div class="search-container">
							<div class="search-input-wrapper">
								<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<circle cx="11" cy="11" r="8"></circle>
									<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
								</svg>
								<input
									type="text"
									class="search-input"
									placeholder="search for content to report..."
									value={feedback.searchQuery}
									oninput={handleSearchInput}
								/>
								{#if feedback.searchLoading}
									<div class="search-spinner"></div>
								{/if}
							</div>

							{#if feedback.searchResults.length > 0}
								<div class="search-results">
									{#each feedback.searchResults as result (feedback.getEntityId(result))}
										<button
											class="search-result"
											onclick={() => feedback.selectEntity(result)}
										>
											<span class="entity-icon">
												{#if result.type === 'track'}
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<path d="M9 18V5l12-2v13"></path>
														<circle cx="6" cy="18" r="3"></circle>
														<circle cx="18" cy="16" r="3"></circle>
													</svg>
												{:else if result.type === 'artist'}
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
														<circle cx="12" cy="7" r="4"></circle>
													</svg>
												{:else if result.type === 'album'}
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<circle cx="12" cy="12" r="10"></circle>
														<circle cx="12" cy="12" r="3"></circle>
													</svg>
												{:else if result.type === 'tag'}
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
														<line x1="7" y1="7" x2="7.01" y2="7"></line>
													</svg>
												{:else if result.type === 'playlist'}
													<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
														<line x1="8" y1="6" x2="21" y2="6"></line>
														<line x1="8" y1="12" x2="21" y2="12"></line>
														<line x1="8" y1="18" x2="21" y2="18"></line>
														<line x1="3" y1="6" x2="3.01" y2="6"></line>
														<line x1="3" y1="12" x2="3.01" y2="12"></line>
														<line x1="3" y1="18" x2="3.01" y2="18"></line>
													</svg>
												{/if}
											</span>
											<span class="result-text">{feedback.getEntityDisplayName(result)}</span>
											<span class="result-type">{result.type}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{:else}
						<div class="selected-entity">
							<span class="entity-icon">
								{#if feedback.selectedEntity.type === 'track'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M9 18V5l12-2v13"></path>
										<circle cx="6" cy="18" r="3"></circle>
										<circle cx="18" cy="16" r="3"></circle>
									</svg>
								{:else if feedback.selectedEntity.type === 'artist'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
										<circle cx="12" cy="7" r="4"></circle>
									</svg>
								{:else if feedback.selectedEntity.type === 'album'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<circle cx="12" cy="12" r="10"></circle>
										<circle cx="12" cy="12" r="3"></circle>
									</svg>
								{:else if feedback.selectedEntity.type === 'tag'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
										<line x1="7" y1="7" x2="7.01" y2="7"></line>
									</svg>
								{:else if feedback.selectedEntity.type === 'playlist'}
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<line x1="8" y1="6" x2="21" y2="6"></line>
										<line x1="8" y1="12" x2="21" y2="12"></line>
										<line x1="8" y1="18" x2="21" y2="18"></line>
										<line x1="3" y1="6" x2="3.01" y2="6"></line>
										<line x1="3" y1="12" x2="3.01" y2="12"></line>
										<line x1="3" y1="18" x2="3.01" y2="18"></line>
									</svg>
								{/if}
							</span>
							<span class="selected-text">{feedback.getEntityDisplayName(feedback.selectedEntity)}</span>
							<button
								class="clear-button"
								onclick={() => feedback.clearSelectedEntity()}
								aria-label="clear selection"
							>
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="18" y1="6" x2="6" y2="18"></line>
									<line x1="6" y1="6" x2="18" y2="18"></line>
								</svg>
							</button>
						</div>
					{/if}

					<div class="form-field">
						<label for="reason-select">reason</label>
						<select
							id="reason-select"
							class="reason-select"
							value={feedback.reason}
							onchange={handleReasonChange}
						>
							<option value="" disabled>select a reason...</option>
							{#each REPORT_REASONS as reasonOption (reasonOption.value)}
								<option value={reasonOption.value}>{reasonOption.label}</option>
							{/each}
						</select>
					</div>

					<div class="form-field">
						<label for="description-input">
							description <span class="optional">(optional)</span>
						</label>
						<textarea
							id="description-input"
							class="description-input"
							placeholder="provide additional details..."
							value={feedback.description}
							oninput={handleDescriptionInput}
							maxlength="1000"
							rows="3"
						></textarea>
						<div class="char-count">
							{feedback.description.length} / 1000
						</div>
					</div>

					{#if feedback.error}
						<div class="error-message">{feedback.error}</div>
					{/if}

					<button
						class="submit-button"
						disabled={!feedback.canSubmit()}
						onclick={() => feedback.submitReport()}
					>
						{#if feedback.isSubmitting}
							<span class="submit-spinner"></span>
							<span>submitting...</span>
						{:else}
							<span>submit report</span>
						{/if}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<style>
	.feedback-backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s;
	}

	.feedback-backdrop.open {
		opacity: 1;
		pointer-events: auto;
	}

	.feedback-modal {
		width: 100%;
		max-width: 440px;
		background: color-mix(in srgb, var(--bg-secondary) 95%, transparent);
		backdrop-filter: blur(20px) saturate(180%);
		-webkit-backdrop-filter: blur(20px) saturate(180%);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-xl);
		box-shadow:
			0 24px 80px color-mix(in srgb, var(--bg-primary) 50%, transparent),
			0 0 1px var(--border-subtle) inset;
		padding: 1.5rem;
		margin: 0 1rem;
		max-height: 90vh;
		overflow-y: auto;
	}

	.feedback-modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.25rem;
	}

	.feedback-modal-header span {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--text-primary);
	}

	.close-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: transparent;
		border: none;
		border-radius: var(--radius-base);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.close-button:hover {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}

	.mode-selector {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.mode-button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-secondary);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		transition: all 0.15s;
	}

	.mode-button:hover {
		border-color: var(--accent);
		color: var(--text-primary);
	}

	.mode-button.active {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
		color: var(--accent);
	}

	.content-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.search-container {
		position: relative;
	}

	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 0.875rem;
		color: var(--text-tertiary);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.75rem 0.875rem 0.75rem 2.5rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		transition: border-color 0.15s;
	}

	.search-input::placeholder {
		color: var(--text-tertiary);
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.search-spinner {
		position: absolute;
		right: 0.875rem;
		width: 16px;
		height: 16px;
		border: 2px solid var(--border-default);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	.search-results {
		position: absolute;
		top: calc(100% + 0.25rem);
		left: 0;
		right: 0;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		max-height: 240px;
		overflow-y: auto;
		z-index: 10;
	}

	.search-result {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.75rem;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border-subtle);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		transition: background 0.15s;
	}

	.search-result:last-child {
		border-bottom: none;
	}

	.search-result:hover {
		background: var(--bg-tertiary);
	}

	.entity-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: var(--bg-tertiary);
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		flex-shrink: 0;
	}

	.result-text {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.result-type {
		color: var(--text-tertiary);
		font-size: var(--text-xs);
		text-transform: uppercase;
	}

	.selected-entity {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
	}

	.selected-text {
		flex: 1;
		color: var(--text-primary);
		font-size: var(--text-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.clear-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-tertiary);
		cursor: pointer;
		transition: all 0.15s;
	}

	.clear-button:hover {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.form-field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.form-field label {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	.form-field .optional {
		color: var(--text-tertiary);
	}

	.reason-select {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.reason-select:focus {
		outline: none;
		border-color: var(--accent);
	}

	.reason-select option {
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.description-input {
		width: 100%;
		padding: 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-default);
		border-radius: var(--radius-base);
		color: var(--text-primary);
		font-family: inherit;
		font-size: var(--text-base);
		resize: vertical;
		min-height: 80px;
		transition: border-color 0.15s;
	}

	.description-input::placeholder {
		color: var(--text-tertiary);
	}

	.description-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.char-count {
		font-size: var(--text-xs);
		color: var(--text-tertiary);
		text-align: right;
	}

	.error-message {
		padding: 0.75rem;
		background: color-mix(in srgb, var(--error) 10%, transparent);
		border: 1px solid var(--error);
		border-radius: var(--radius-base);
		color: var(--error);
		font-size: var(--text-sm);
	}

	.success-message {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: color-mix(in srgb, var(--success) 10%, transparent);
		border: 1px solid var(--success);
		border-radius: var(--radius-base);
		color: var(--success);
		font-size: var(--text-sm);
	}

	.submit-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.875rem 1rem;
		background: var(--accent);
		border: none;
		border-radius: var(--radius-base);
		color: var(--bg-primary);
		font-family: inherit;
		font-size: var(--text-base);
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.submit-button:hover:not(:disabled) {
		background: var(--accent-hover);
	}

	.submit-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.submit-spinner {
		width: 16px;
		height: 16px;
		border: 2px solid color-mix(in srgb, var(--bg-primary) 30%, transparent);
		border-top-color: var(--bg-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
