// iOS Safari zooms the page when an input under 16px takes focus.
import { describe, it, expect } from 'vitest';
import { parse, type AST } from 'svelte/compiler';
import source from './HiddenTagsFilter.svelte?raw';

const css = parse(source, { modern: true }).css;

function addInputFontSizes(media: string): string[] {
	const atrule = css?.children.find(
		(node): node is AST.CSS.Atrule => node.type === 'Atrule' && node.prelude.includes(media)
	);
	return (atrule?.block?.children ?? [])
		.filter(
			(rule): rule is AST.CSS.Rule =>
				rule.type === 'Rule' &&
				/\.add-input\b/.test(source.slice(rule.prelude.start, rule.prelude.end))
		)
		.flatMap((rule) => rule.block.children)
		.filter(
			(decl): decl is AST.CSS.Declaration =>
				decl.type === 'Declaration' && decl.property === 'font-size'
		)
		.map((decl) => decl.value);
}

describe('HiddenTagsFilter input on phones', () => {
	it('is 16px at the mobile breakpoint so iOS does not zoom on focus', () => {
		expect(addInputFontSizes('max-width: 768px')).toEqual(['16px']);
	});

	it('is not shrunk again by the narrower breakpoint', () => {
		expect(addInputFontSizes('max-width: 480px')).toEqual([]);
	});
});
