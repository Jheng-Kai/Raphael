import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

test('member question cards retain their quiet appearance when glows move to pseudo elements', () => {
  for(const [file,selector] of [['agent.css','.ask-card.is-member::before'],['background-questions.css','.bgq-card.is-member::before']]){
    const css=readFileSync(resolve(__dirname,'main',file!),'utf8');
    const rule=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match=>match[1]!.split(',').some(value=>value.trim()===selector));
    expect(rule?.[2]?.includes('display: none')).toBe(true);
  }
});

test('R-PERF-01: endless motion only changes compositable properties with the named large-avatar container exception', () => {
  const failures: string[] = [];
  const directory = resolve(__dirname, 'main');
  for (const file of readdirSync(directory).filter(file => file.endsWith('.css'))) {
    const css = readFileSync(resolve(directory, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const largeRanges = [...css.matchAll(/@container \(width > 72px\)\s*\{/g)].map(match => {
      let depth=1, end=match.index!+match[0].length;
      for (;end<css.length && depth;end++) { if(css[end]==='{')depth++;else if(css[end]==='}')depth--; }
      return [match.index!,end];
    });
    const frames = new Map([...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(match => [match[1], match[2]]));
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*\binfinite\b[^{}]*)\}/g)) {
      const [, selector, declaration] = match;
      const large = file === 'slime.css' && selector.includes('.slime[data-state=') && largeRanges.some(([start,end]) => match.index! >= start! && match.index! < end!);
      if (selector.includes('.slime') && !/\.slime-(?:eye-|blink-|prop-)?cels/.test(selector) && !large) failures.push(`${file}: SVG loop outside large-avatar-vector: ${selector.trim()}`);
      for (const [name, body] of frames) if (new RegExp(`\\b${name}\\b`).test(declaration)) {
        const names = [...body.matchAll(/([\w-]+)\s*:/g)].map(match => match[1]);
        if (!large && names.some(name => !['transform','opacity','translate','rotate','scale','animation-timing-function'].includes(name))) failures.push(`${file}: ${name}: ${names.join(', ')}`);
      }
    }
  }
  expect(failures).toEqual([]);
});
