import { describe, expect, it } from 'vitest';
import { recoveryArgv } from '../src/core/forensics/recovery.js';
describe('exact recovery argv',()=>{ it('uses saved slug and only live/harvest',()=>{ for(const a of ['live','harvest'] as const){ const v=recoveryArgv(['oracle'],'slug-123',a,'/tmp/out'); expect(v).toEqual(['oracle','session','slug-123',`--${a}`,'--write-output','/tmp/out']); expect(v.join(' ')).not.toMatch(/prompt|restart/); } }); });
