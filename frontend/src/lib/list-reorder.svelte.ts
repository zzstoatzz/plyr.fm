// list-reorder — shared drag-to-reorder state machine for edit-mode track
// lists (playlist + album detail). desktop HTML5 drag and touch drag share one
// instance: the page owns the array and passes an onMove callback; this module
// owns the gesture state and the drop/hit-testing logic.
//
// usage:
//   const reorder = createListReorder((from, to) => (tracks = moveItem(tracks, from, to)));
//
//   <div bind:this={reorder.listElement}
//        ontouchmove={reorder.handleTouchMove} ontouchend={reorder.handleTouchEnd} ...>
//     {#each tracks as track, i (track.id)}
//       <div class="track-row" data-index={i} draggable="true"
//            class:drag-over={reorder.dragOverIndex === i && reorder.touchDragIndex !== i}
//            class:is-dragging={reorder.touchDragIndex === i || reorder.draggedIndex === i}
//            ondragstart={(e) => reorder.handleDragStart(e, i)} ...>
//         <button ontouchstart={(e) => reorder.handleTouchStart(e, i)}>⠿</button>

export interface ListReorderOptions {
	/** selector for the reorderable rows inside the list element (default: '.track-row') */
	rowSelector?: string;
}

/** return a copy of items with the element at fromIndex moved to toIndex. */
export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
	if (fromIndex === toIndex) return items;
	const next = [...items];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	return next;
}

export function createListReorder(
	onMove: (fromIndex: number, toIndex: number) => void,
	options: ListReorderOptions = {}
) {
	const { rowSelector = '.track-row' } = options;

	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	let touchDragIndex = $state<number | null>(null);
	let touchStartY = 0;
	let touchDragElement: HTMLElement | null = null;

	let listElement: HTMLElement | null = null;

	return {
		get draggedIndex() {
			return draggedIndex;
		},
		get dragOverIndex() {
			return dragOverIndex;
		},
		get touchDragIndex() {
			return touchDragIndex;
		},
		get listElement() {
			return listElement;
		},
		set listElement(el: HTMLElement | null) {
			listElement = el;
		},

		// desktop drag and drop
		handleDragStart(event: DragEvent, index: number) {
			draggedIndex = index;
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
			}
		},

		handleDragOver(event: DragEvent, index: number) {
			event.preventDefault();
			dragOverIndex = index;
		},

		handleDrop(event: DragEvent, index: number) {
			event.preventDefault();
			if (draggedIndex !== null && draggedIndex !== index) {
				onMove(draggedIndex, index);
			}
			draggedIndex = null;
			dragOverIndex = null;
		},

		handleDragEnd() {
			draggedIndex = null;
			dragOverIndex = null;
		},

		// touch drag and drop
		handleTouchStart(event: TouchEvent, index: number) {
			const touch = event.touches[0];
			touchDragIndex = index;
			touchStartY = touch.clientY;
			touchDragElement = event.currentTarget as HTMLElement;
			touchDragElement.classList.add('touch-dragging');
		},

		handleTouchMove(event: TouchEvent) {
			if (touchDragIndex === null || !touchDragElement || !listElement) return;

			event.preventDefault();
			const touch = event.touches[0];
			const offset = touch.clientY - touchStartY;
			touchDragElement.style.transform = `translateY(${offset}px)`;

			const rowElements = listElement.querySelectorAll(rowSelector);
			for (let i = 0; i < rowElements.length; i++) {
				const rowEl = rowElements[i] as HTMLElement;
				const rect = rowEl.getBoundingClientRect();
				const midY = rect.top + rect.height / 2;

				if (touch.clientY < midY && i > 0) {
					const targetIndex = parseInt(rowEl.dataset.index || '0');
					if (targetIndex !== touchDragIndex) {
						dragOverIndex = targetIndex;
					}
					break;
				} else if (touch.clientY >= midY) {
					const targetIndex = parseInt(rowEl.dataset.index || '0');
					if (targetIndex !== touchDragIndex) {
						dragOverIndex = targetIndex;
					}
				}
			}
		},

		handleTouchEnd() {
			if (touchDragIndex !== null && dragOverIndex !== null && touchDragIndex !== dragOverIndex) {
				onMove(touchDragIndex, dragOverIndex);
			}

			if (touchDragElement) {
				touchDragElement.classList.remove('touch-dragging');
				touchDragElement.style.transform = '';
			}

			touchDragIndex = null;
			dragOverIndex = null;
			touchDragElement = null;
		}
	};
}
