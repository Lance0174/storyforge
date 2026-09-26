import { describe, expect, it } from 'vitest'
import { classifyRequestedDomainIdsV1 } from '../../src/lib/agent/workflow-catalog'

describe('Feedback #91: world context does not request character production', () => {
  it.each([
    '修改世界设定中的力量体系，主角也遵守该机制',
    '修改世界设定中的力量体系，人物也遵守该机制',
    '修改世界设定，主角的能力也受约束',
    '修改主角所在的世界设定',
    '修改世界设定中主角受到的规则限制',
  ])('%s', request => {
    expect([...classifyRequestedDomainIdsV1(request)]).toEqual(['world-origin'])
  })
  it.each([
    '创建世界设定，并设计一位主角',
    '创建世界并生成主角',
    '创建世界和主角',
    '修改世界设定，完善主角的外貌',
    '建立世界，主角的外貌需要修改',
    '世界设定需要修改，同时设计一位主角',
    '修改创作规则，并设计一位主角',
  ])('preserves explicitly requested character work: %s', request => {
    expect([...classifyRequestedDomainIdsV1(request)]).toEqual(['world-origin', 'character'])
  })
  it.each([
    '设计这个世界中的主角',
    '基于已有世界设定设计一位主角',
    '按照世界规则，设计反派',
    '按世界设定修改现有角色',
    '基于现有世界设定补充角色外貌',
    '不要修改世界设定，只设计主角',
  ])('using existing world context does not authorize world production: %s', request => {
    expect([...classifyRequestedDomainIdsV1(request)]).toEqual(['character'])
  })
  it('keeps explicit world edits when a rule mentions a character and another character is requested', () => {
    expect([...classifyRequestedDomainIdsV1('修改世界设定中主角受到的规则限制，并设计一位反派')])
      .toEqual(['world-origin', 'character'])
  })
  it('retains character-only and downstream workflows', () => {
    expect([...classifyRequestedDomainIdsV1('主角')]).toEqual(['character'])
    expect([...classifyRequestedDomainIdsV1('设计主角')]).toEqual(['character'])
    expect([...classifyRequestedDomainIdsV1('以主角视角写第一章正文')]).toEqual(['prose'])
  })
})
