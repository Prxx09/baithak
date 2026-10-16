import type { VideoChoice } from './playback';
type Fetcher=typeof fetch;
function clean(text:string){return text.replace(/\[[^\]]*\]|\([^)]*\)/g,'').replace(/official|music video|lyric(s)?|audio|HD|4K/gi,'').replace(/\s+/g,' ').trim();}
export function recommendationQuery(title:string,channel:string):string {
  const artist=title.split(/\s[-–|]\s/)[0];
  return clean(artist!==title?artist:channel.replace(/VEVO|\s*-\s*Topic/gi,''))||clean(title).slice(0,100)||channel;
}
export function freshChoices(choices:VideoChoice[],excluded:Set<string>):VideoChoice[]{
  const seen=new Set(excluded);return choices.filter(choice=>{if(!/^[A-Za-z0-9_-]{11}$/.test(choice.id)||seen.has(choice.id))return false;seen.add(choice.id);return true;});
}
async function api(path:string,params:Record<string,string>,key:string,request:Fetcher){
  if(!key)throw new Error('YouTube discovery is not configured. Queued videos can still play continuously.');
  const url=new URL(`https://www.googleapis.com/youtube/v3/${path}`);url.search=new URLSearchParams({...params,key}).toString();
  const response=await request(url,{signal:AbortSignal.timeout(12000)});const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message||'YouTube discovery is temporarily unavailable.');return data;
}
export async function recommendations(seed:string,excluded:Set<string>,key:string,request:Fetcher=fetch):Promise<VideoChoice[]>{
  const metadata=await api('videos',{part:'snippet',id:seed},key,request);const snippet=metadata.items?.[0]?.snippet;
  if(!snippet)return [];
  // The deprecated relatedToVideoId endpoint is intentionally not used. This is contextual discovery, not YouTube's personalized feed.
  const results=await api('search',{part:'snippet',type:'video',videoEmbeddable:'true',videoSyndicated:'true',maxResults:'12',q:recommendationQuery(snippet.title,snippet.channelTitle),...(snippet.categoryId?{videoCategoryId:snippet.categoryId}:{})},key,request);
  return freshChoices(results.items.map((v:{id:{videoId:string};snippet:{title:string;channelTitle:string}})=>({id:v.id.videoId,title:v.snippet.title,channel:v.snippet.channelTitle})),excluded);
}
export async function playlistPage(id:string,token:string,key:string,request:Fetcher=fetch):Promise<{items:VideoChoice[];nextToken:string|null}>{
  const page=await api('playlistItems',{part:'snippet',playlistId:id,maxResults:'20',...(token?{pageToken:token}:{})},key,request);
  const items=(page.items||[]).filter((v:{snippet:{title:string;resourceId?:{videoId:string}}})=>v.snippet.resourceId?.videoId&&!['Private video','Deleted video'].includes(v.snippet.title)).map((v:{snippet:{title:string;resourceId:{videoId:string}}})=>({id:v.snippet.resourceId.videoId,title:v.snippet.title}));
  return {items,nextToken:page.nextPageToken||null};
}
