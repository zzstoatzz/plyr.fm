import { mount } from 'svelte';
import TagInputProbe from './fixtures/TagInputProbe.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('missing probe target');
mount(TagInputProbe, { target });
