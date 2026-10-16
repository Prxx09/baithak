import { describe,it,expect,vi } from 'vitest';
import { playlistPage } from './discovery';
import { playlistId } from './playback';

describe('YouTube playlist discovery',()=>{
  it('recognizes playlist-only and video-with-playlist links',()=>{
    expect(playlistId('https://www.youtube.com/playlist?list=PL1234567890123')).toBe('PL1234567890123');
    expect(playlistId('https://youtu.be/M7lc1UVf-VE?list=PL1234567890123')).toBe('PL1234567890123');
    expect(playlistId('https://youtube.com.evil.test/playlist?list=PL1234567890123')).toBeNull();
  });
  it('keeps page tokens and skips private/deleted entries',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({nextPageToken:'PAGE2',items:[{snippet:{title:'Song',resourceId:{videoId:'aqz-KE-bpKQ'}}},{snippet:{title:'Private video',resourceId:{videoId:'M7lc1UVf-VE'}}}]})));
    const page=await playlistPage('PL1234567890123','PAGE1','key',fetcher);
    expect(page.items).toHaveLength(1);expect(page.nextToken).toBe('PAGE2');
    expect((fetcher.mock.calls[0][0] as URL).searchParams.get('pageToken')).toBe('PAGE1');
  });
  it('surfaces quota failures without retrying indefinitely',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:'Quota exceeded'}}),{status:403}));
    await expect(playlistPage('PL1234567890123','','key',fetcher)).rejects.toThrow('Quota exceeded');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
