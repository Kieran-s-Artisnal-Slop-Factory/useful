import { describe, expect, it } from 'vitest';
import { configTagName, generateConfigWebComponent } from './configWebcomponent';
import type { ConfigCodeTemplate } from './config';
import type { ConfigField, ConfigFieldType } from '../db/types';

const field = (key: string, type: ConfigFieldType, optional = false): ConfigField => ({
  key,
  type,
  optional,
  nullable: false,
});

const template: ConfigCodeTemplate = {
  name: 'Deploy settings',
  format: 'json',
  fields: [
    field('name', { kind: 'string' }),
    field('replicas', { kind: 'integer' }),
    field('owner', { kind: 'email' }),
    field('tier', { kind: 'enum', values: ['dev', 'prod'] }),
    field('tags', { kind: 'array', item: { kind: 'string' } }, true),
    field('<img src=x onerror=alert(1)> */', { kind: 'any' }, true),
  ],
};

describe('configTagName', () => {
  it('always has a hyphen and starts with a letter', () => {
    expect(configTagName('Deploy settings', 'parser')).toBe('deploy-settings-parser');
    expect(configTagName('Person', 'generator')).toBe('person-generator');
    expect(configTagName('', 'parser')).toBe('config-parser');
    expect(configTagName('2 for 1', 'parser')).toBe('config-2-for-1-parser');
    for (const name of ['Deploy settings', 'Person', '', '2 for 1', '!!!', 'é ü']) {
      for (const flavor of ['parser', 'generator'] as const) {
        expect(configTagName(name, flavor), name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/);
      }
    }
  });
});

describe('the parser component', () => {
  const source = generateConfigWebComponent(template, 'parser');

  it('defines and registers one element', () => {
    expect(source).toContain('class DeploySettingsParser extends HTMLElement');
    expect(source).toContain('customElements.define("deploy-settings-parser", DeploySettingsParser);');
  });

  it('has no dependency, no import and no external URL', () => {
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toContain('require(');
  });

  it('ships the shared validator and the schema, and parts to style by', () => {
    expect(source).toContain('function _validate(');
    expect(source).toContain('const _FORMATS = {');
    expect(source).toContain('const FIELDS = [');
    // The shadow markup is a JSON string literal, so its quotes are escaped.
    for (const part of ['textarea', 'status', 'issues', 'rows']) {
      expect(source, part).toContain(`part=\\"${part}\\"`);
    }
    for (const part of ['issue', 'row']) {
      expect(source, part).toContain(`setAttribute('part', '${part}')`);
    }
    expect(source).toContain("'config-valid'");
    // The generator's machinery stays out of a parser.
    expect(source).not.toContain('function _generate(');
    expect(source).not.toContain('function _mulberry32(');
  });

  it('parses as JavaScript with the hostile key and name in place', () => {
    expect(() => new Function(`return (async () => {${source}})`)).not.toThrow();
    // The key is data inside FIELDS — a JSON string literal — and reaches the
    // table only through _escape, never as raw markup.
    expect(source).toContain(JSON.stringify('<img src=x onerror=alert(1)> */'));
    expect(source).toContain('_escape(field.key)');
    expect(source).not.toContain('innerHTML = field.key');
    // A `*/` in a key must not end the header comment early.
    expect(source.indexOf(' */\nconst FIELDS')).toBeGreaterThan(0);
    expect(source.slice(0, source.indexOf('const FIELDS'))).not.toContain('<img');
  });

  it('says out loud that it takes JSON only when the schema is YAML', () => {
    const yamlSource = generateConfigWebComponent({ ...template, format: 'yaml' }, 'parser');
    expect(yamlSource).toContain('JSON');
    expect(yamlSource).toContain('part=\\"note\\"');
    expect(yamlSource).toContain('JSON input only');
    expect(source).not.toContain('part=\\"note\\"');
  });
});

describe('the generator component', () => {
  const source = generateConfigWebComponent(template, 'generator');

  it('defines and registers one element, with a button and an output', () => {
    expect(source).toContain('customElements.define("deploy-settings-generator", DeploySettingsGenerator);');
    for (const part of ['input', 'button', 'output']) {
      expect(source, part).toContain(`part=\\"${part}\\"`);
    }
    expect(source).toContain("'config-generated'");
    expect(source).toContain('function _generate(');
    expect(source).toContain('function _mulberry32(');
    expect(source).not.toContain('function _validate(');
  });

  it('parses as JavaScript', () => {
    expect(() => new Function(`return (async () => {${source}})`)).not.toThrow();
  });

  it('emits YAML documents only when the schema is YAML', () => {
    expect(source).not.toContain('function _toYaml(');
    expect(source).toContain('JSON.stringify(documents');
    const yamlSource = generateConfigWebComponent({ ...template, format: 'yaml' }, 'generator');
    expect(yamlSource).toContain('function _toYaml(');
    expect(yamlSource).toContain("join('\\n---\\n')");
  });

  it('honours a seed attribute', () => {
    expect(source).toContain("getAttribute('seed')");
  });
});
