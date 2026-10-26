// the links menu must fit a phone with the player open instead of scrolling the stats away.
import { describe, it, expect } from 'vitest';
import { parse, type AST } from 'svelte/compiler';
import source from './LinksMenu.svelte?raw';

const css = parse(source, { modern: true }).css;

function declarations(media: string, selector: string): Record<string, string> {
	const atrule = css?.children.find(
		(node): node is AST.CSS.Atrule => node.type === 'Atrule' && node.prelude.includes(media)
	);
	const rule = (atrule?.block?.children ?? []).find(
		(node): node is AST.CSS.Rule =>
			node.type === 'Rule' &&
			source.slice(node.prelude.start, node.prelude.end).trim() === selector
	);
	return Object.fromEntries(
		(rule?.block.children ?? [])
			.filter((decl): decl is AST.CSS.Declaration => decl.type === 'Declaration')
			.map((decl) => [decl.property, decl.value])
	);
}

describe('LinksMenu on phones', () => {
	it('spans the screen width', () => {
		expect(declarations('max-width: 768px', '.menu-popover').width).toBe('calc(100vw - 1.5rem)');
	});

	it('lays the links out in two columns', () => {
		const links = declarations('max-width: 768px', '.menu-links');
		expect(links.display).toBe('grid');
		expect(links['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
	});
});
