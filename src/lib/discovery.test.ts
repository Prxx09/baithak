import { describe,it,expect,vi } from 'vitest';
import { freshChoices,recommendationQuery,recommendations,playlistPage } from './discovery';
import { playlistId } from './playback';
describe('continuous YouTube discovery',()=>{
  it('recognizes playlist-only and video-with-playlist links',()=>{expect(playlistId('https://www.youtube.com/playlist?list=PL1234567890123')).toBe('PL1234567890123');expect(playlistId('https://youtu.be/M7lc1UVf-VE?list=PL1234567890123')).toBe('PL1234567890123');expect(playlistId('https://youtube.com.evil.test/playlist?list=PL1234567890123')).toBeNull();});
  it('uses artist or channel context instead of deprecated relatedToVideoId',()=>{expect(recommendationQuery('Artist - Song (Official Video)','ArtistVEVO')).toBe('Artist');expect(recommendationQuery('Some song','Artist - Topic')).toBe('Artist');});
  it('excludes previously played, queued, duplicate, and invalid videos',()=>{expect(freshChoices([{id:'M7lc1UVf-VE',title:'Seen'},{id:'aqz-KE-bpKQ',title:'Fresh'},{id:'aqz-KE-bpKQ',title:'Duplicate'},{id:'bad',title:'Bad'}],new Set(['M7lc1UVf-VE']))).toEqual([{id:'aqz-KE-bpKQ',title:'Fresh'}]);});
  it('prefetches an embeddable contextual choice through the supported API',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({items:[{snippet:{title:'Artist - Song',channelTitle:'ArtistVEVO',categoryId:'10'}}]}))).mockResolvedValueOnce(new Response(JSON.stringify({items:[{id:{videoId:'aqz-KE-bpKQ'},snippet:{title:'Another song',channelTitle:'Artist'}}]})));
    const choices=await recommendations('M7lc1UVf-VE',new Set(['M7lc1UVf-VE']),'test-key',fetcher);expect(choices[0].id).toBe('aqz-KE-bpKQ');const url=fetcher.mock.calls[1][0] as URL;expect(url.searchParams.get('q')).toBe('Artist');expect(url.searchParams.get('videoEmbeddable')).toBe('true');expect(url.searchParams.has('relatedToVideoId')).toBe(false);
  });
  it('keeps playlist page tokens and skips private/deleted entries',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({nextPageToken:'PAGE2',items:[{snippet:{title:'Song',resourceId:{videoId:'aqz-KE-bpKQ'}}},{snippet:{title:'Private video',resourceId:{videoId:'M7lc1UVf-VE'}}}]})));const page=await playlistPage('PL1234567890123','PAGE1','key',fetcher);expect(page.items).toHaveLength(1);expect(page.nextToken).toBe('PAGE2');expect((fetcher.mock.calls[0][0] as URL).searchParams.get('pageToken')).toBe('PAGE1');});
  it('surfaces quota failures without retrying indefinitely',async()=>{const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:'Quota exceeded'}}),{status:403}));await expect(recommendations('M7lc1UVf-VE',new Set(),'key',fetcher)).rejects.toThrow('Quota exceeded');expect(fetcher).toHaveBeenCalledTimes(1);});
});
