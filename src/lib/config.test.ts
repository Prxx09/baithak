import { describe,it,expect } from 'vitest';
import { parseRoomCode,friendlyError } from './config';
describe('invitation parsing',()=>{
  it('accepts room codes and strips accidental spaces',()=>expect(parseRoomCode(' a1 b2 ')).toBe('a1b2'));
  it('extracts the room from a shared link',()=>expect(parseRoomCode('https://baithak.example/?room=abcdef')).toBe('abcdef'));
  it('rejects a URL without an invitation',()=>expect(parseRoomCode('https://baithak.example/')).toBe(''));
});
describe('setup errors',()=>{
  it('explains disabled guest authentication',()=>expect(friendlyError(new Error('Anonymous sign-ins are disabled'))).toContain('Authentication'));
  it('explains missing schema',()=>expect(friendlyError({message:'Could not find baithak_command in the schema cache'})).toContain('SQL setup'));
});
