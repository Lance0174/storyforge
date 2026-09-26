import {afterEach,beforeEach,expect,it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createWorkspace} from '../../src/lib/workspace/create-workspace'
import {createWorldWork,switchActiveWork,updateWorkCover} from '../../src/lib/workspace/works'
import {readHomeCatalog,readHomeResume,rememberHomeWork,runWorkPath,validWorkPath,workPath} from '../../src/lib/home/catalog'
import {readHomeData} from '../../src/components/home/useHomeData'
import {searchHome} from '../../src/lib/home/search'
import type {AgentRunRecord, Chapter} from '../../src/lib/types'
import {stampNewRecord} from '../../src/lib/workspace/scope'
beforeEach(async()=>{await db.delete();await db.open();localStorage.clear()});afterEach(()=>db.close())
const create=(name:string,purpose:'world-engine'|'independent-work'='independent-work')=>createWorkspace({name,description:'沿海城镇',genres:[],status:'drafting',targetWordCount:10000},{purpose,kind:'novel',novelProfile:'long'})
it('separates real works from shareable worlds and removes invalid roots',async()=>{const a=await create('故事'),b=await create('世界','world-engine');let data=await readHomeCatalog();expect(data.works.map(r=>r.work.title)).toEqual(['故事']);expect(data.worlds.map(w=>w.name)).toEqual(['世界']);await db.worlds.delete(a.world.id!);data=await readHomeCatalog();expect(data.works).toHaveLength(0);expect(data.rows[0].work.id).toBe(b.work.id)})
it('resumes exact identity and chapter; rejects foreign routes and recycled IDs',async()=>{const a=await create('故事');const [row]=(await readHomeCatalog()).works;const path=`/workspace/${a.project.id}?module=chapters-list&chapter=18`;rememberHomeWork(row,path);expect(readHomeResume([row])?.path).toBe(path);expect(validWorkPath(row,'https://example.com')).toBe(false);expect(validWorkPath(row,'//example.com')).toBe(false);expect(validWorkPath(row,`/workspace/${a.project.id!+1}`)).toBe(false);expect(readHomeResume([{...row,work:{...row.work,code:'different'}}])?.path).toBe(workPath(row))})
it('routes an outline candidate back to outline rather than revision impact',async()=>{await create('故事');const [row]=(await readHomeCatalog()).works;const run={contractJson:JSON.stringify({permissions:{writeTargets:[{table:'outlineNodes',fields:['title']}]}})} as AgentRunRecord;expect(runWorkPath(row,run)).toBe(`/workspace/${row.project.id}?module=outline`)})
it('cover save uses explicit Work scope and CAS rather than whichever Work is active',async()=>{const a=await create('封面目标');const other=await createWorldWork(a.project.id!,{title:'同世界另一叙事',kind:'novel',novelProfile:'long'});await switchActiveWork(a.project.id!,other.id!);const image='data:image/png;base64,AAAA';const updated=await updateWorkCover(a.scope,image,a.work.updatedAt);expect(updated).toBeGreaterThan(a.work.updatedAt);expect((await db.works.get(a.work.id!))?.coverImage).toBe(image);expect((await db.works.get(other.id!))?.coverImage).toBeUndefined();await expect(updateWorkCover(a.scope,'',a.work.updatedAt)).rejects.toThrow('已被修改');const b=await create('其他');await expect(updateWorkCover({...a.scope,worldId:b.world.id!},image,updated)).rejects.toThrow();await expect(updateWorkCover(a.scope,'data:image/svg+xml;base64,AAAA',updated)).rejects.toThrow('封面')})
it('local search uses actual data, honors type and Work filter, and returns empty for no match',async()=>{const a=await create('潮水手稿');await create('灯塔世界','world-engine');expect((await searchHome('潮水')).items.map(r=>r.title)).toContain('潮水手稿');expect((await searchHome('不可能命中')).items).toHaveLength(0);expect((await searchHome('灯塔','worlds')).items).toHaveLength(1);expect((await searchHome('灯塔','worlds',a.work.id)).items).toHaveLength(0)})

it('aggregates Work-owned tasks without requiring worldId; rejects wrong owners and runtime records',async()=>{
 const a=await create('主作品'),b=await create('另一个作品')
 const base={projectId:a.project.id!,workId:a.work.id!,status:'paused',contractJson:'{}',contractHash:'a'.repeat(64),contractVersion:1,generation:0,lastSequence:0,projectionJson:'{}',projectionHash:'b'.repeat(64),createdAt:1,updatedAt:1} as AgentRunRecord
 await db.agentRuns.bulkAdd([base,{...base,projectId:b.project.id!},{...base,workId:null,productRuntimeSessionId:42}])
 const data=await readHomeData();expect(data.runs).toHaveLength(1);expect(data.runs[0].workId).toBe(a.work.id)
})

it('reads longform library word counts from saved canonical prose, scoped to each Work without rewriting metadata', async () => {
 const a = await create('采纳后的字数'), b = await create('另一部作品')
 const body = {outlineNodeId: 1, title: '第一章', content: '<p>夜班邮差归来</p>', wordCount: 9999, status: 'draft' as const, order: 0, notes: '', createdAt: 1, updatedAt: 1}
 const chapterId = await db.chapters.add(stampNewRecord(a.scope, 'chapters', body, {owner: 'work'}) as Chapter)
 await db.chapters.add(stampNewRecord(a.scope, 'chapters', {...body, content: '', wordCount: 50000}, {owner: 'work'}) as Chapter)
 await db.chapters.add(stampNewRecord(b.scope, 'chapters', {...body, content: '<p>另一故事</p>'}, {owner: 'work'}) as Chapter)
 const before = await db.works.get(a.work.id!)
 let rows = (await readHomeCatalog()).works
 expect(rows.find(row => row.work.id === a.work.id)?.work.currentWordCount).toBe(6)
 expect(rows.find(row => row.work.id === b.work.id)?.work.currentWordCount).toBe(4)
 expect(await db.works.get(a.work.id!)).toEqual(before)
 await db.chapters.update(chapterId, {content: '<p>来信</p>'})
 rows = (await readHomeCatalog()).works
 expect(rows.find(row => row.work.id === a.work.id)?.work.currentWordCount).toBe(2)
 await db.chapters.delete(chapterId)
 expect((await readHomeCatalog()).works.find(row => row.work.id === a.work.id)?.work.currentWordCount).toBe(0)
})


it('integrated products resume their own editor and reject another work or product',async()=>{
 await create('导航归属');const [original]=(await readHomeCatalog()).works;
 for(const [kind,route] of [['comic','comic'],['motion-drama','motion'],['character-interaction','chat']] as const){
  const row={...original,work:{...original.work,kind,novelProfile:null}};
  const path=workPath(row);expect(path.startsWith(`/${route}/`)).toBe(true);expect(validWorkPath(row,path)).toBe(true);
  const url=new URL(path,'https://storyforge.local');url.searchParams.set('work',String(row.work.id!+1));expect(validWorkPath(row,url.pathname+url.search)).toBe(false);
  expect(validWorkPath(row,`/short/intent?project=${row.project.id}`)).toBe(false);
 }
})
