// Unit: the NCBI-genomic-context path through the model + adapters — the downstream gene
// drawn TO SCALE (buildArchitecture + toLinearMapProps) and the WHOLE locus as one continuous
// SequenceViewer track (toLocusSequenceData). The no-gene path (no context / unresolved gene) is
// covered by the existing architectureMap tests; here we pin the to-scale + continuous-track
// behaviour and a real round-trip against the committed public/data/locus_context artifact.
import { describe, expect, test } from 'vitest'
import { buildArchitecture, bodyWindow } from '../../src/lib/architecture'
import { toLinearMapProps, toSequenceData, toLocusSequenceData, DOWNSTREAM_ORF_ID } from '../../src/lib/architectureMap'
import { aaColor, FUNC_CLASS_SHADE } from '../../src/lib/color'
import type { FeatureName, LocusContext, Member, Span } from '../../src/lib/data/types'
import { makeMember } from '../fixtures'
import membersJson from '../../public/data/members.json'
import ctxT0001 from '../../public/data/locus_context/T0001.json'
import ctxT0342 from '../../public/data/locus_context/T0342.json'

const MISSING: Span = [0, 0]
function m(o: {
  id: string
  ordinal: number
  aa: string | null
  leader: [number, number]
  window?: Partial<Record<FeatureName, Span>>
}): Member {
  const window: Record<FeatureName, Span> = {
    tbox: MISSING, s1: MISSING, s1_loop: MISSING, codon: MISSING, antiterm: MISSING, term: MISSING, discrim: MISSING,
    ...o.window,
  }
  return makeMember({
    member_id: o.id,
    tandem_id: o.id.split('.')[0],
    ordinal: o.ordinal,
    specifier: { aa: o.aa, codon: null },
    coords: { leader: o.leader, window, genome: window },
    fasta_sequence: 'A'.repeat(Math.abs(o.leader[1] - o.leader[0]) + 1),
  })
}

const ALL_MEMBERS = membersJson as unknown as Record<string, Member>
const membersOf = (tid: string) => Object.values(ALL_MEMBERS).filter((mm) => mm.tandem_id === tid)

/** A minimal context (overridable) whose offsets match the synthetic members in each test. */
function ctx(over: Partial<LocusContext>): LocusContext {
  return {
    tandem_id: 'P', accession: 'ACC', strand: '+', resolved: true,
    interval: [1, 100], seq: 'A'.repeat(100), elements: [], downstream_genes: [], warnings: [],
    ...over,
  }
}

describe('buildArchitecture — with locus context', () => {
  const members = [
    m({ id: 'P.m1', ordinal: 1, aa: 'TRP', leader: [100, 279], window: { tbox: [10, 60], codon: [28, 30] } }),
    m({ id: 'P.m2', ordinal: 2, aa: 'VAL', leader: [400, 579], window: { tbox: [10, 60], codon: [28, 30] } }),
  ]

  test('no context → byte-identical to the 2-arg call (no genes, not to scale)', () => {
    const a = buildArchitecture(members, '+')
    const b = buildArchitecture(members, '+', null)
    expect(a.genes).toBeUndefined()
    expect(a.toScale).toBe(false)
    expect(b).toEqual(a)
  })

  test('resolved context → genes laid out to scale at their seq offsets', () => {
    const model = buildArchitecture(members, '+', ctx({
      seq: 'C'.repeat(900),
      elements: [{ member_id: 'P.m1', offset: 0, length: 180 }, { member_id: 'P.m2', offset: 300, length: 180 }],
      downstream_genes: [
        { name: 'geneX', protein_id: 'P1.1', locus_tag: null, offset: 520, length: 300, strand: '+', resolution: 'coded_by' },
        { name: 'geneY', protein_id: 'P2.1', locus_tag: null, offset: 830, length: 60, strand: '-', resolution: 'coded_by' },
      ],
    }))
    expect(model.toScale).toBe(true)
    expect(model.genes).toEqual([
      { start: 520, end: 820, coOriented: true, label: 'geneX' },
      { start: 830, end: 890, coOriented: false, label: 'geneY' }, // minus gene on a + locus → not co-oriented
    ])
  })

  test('an unresolved context resolves no gene (not to scale, no genes)', () => {
    const model = buildArchitecture(members, '+', ctx({ resolved: false, downstream_genes: [] }))
    expect(model.genes).toBeUndefined()
    expect(model.toScale).toBe(false)
  })

  test('a gene that runs off the interval is dropped (defensive)', () => {
    const model = buildArchitecture(members, '+', ctx({
      seq: 'C'.repeat(100),
      downstream_genes: [{ name: 'bad', protein_id: 'X', locus_tag: null, offset: 90, length: 50, strand: '+', resolution: 'coded_by' }],
    }))
    expect(model.toScale).toBe(false) // the only gene was out of range → no gene drawn
  })
})

describe('toLinearMapProps — to-scale downstream gene', () => {
  const members = [m({ id: 'P.m1', ordinal: 1, aa: 'TRP', leader: [100, 279], window: { tbox: [10, 60] } })]

  test('draws the gene at real coords (chrome), not the schematic ORF', () => {
    const model = buildArchitecture(members, '+', ctx({
      seq: 'C'.repeat(800),
      elements: [{ member_id: 'P.m1', offset: 0, length: 180 }],
      downstream_genes: [{ name: 'lysW', protein_id: 'P1.1', locus_tag: 'tag1', offset: 400, length: 300, strand: '+', resolution: 'coded_by' }],
    }))
    const { parts, size } = toLinearMapProps(model, 'biosynthesis', 'lysW')
    const gene = parts.find((p) => p.id === DOWNSTREAM_ORF_ID)!
    expect(gene).toMatchObject({ type: 'gene', start: 400, end: 700, color: FUNC_CLASS_SHADE.biosynthesis, label: 'lysW' })
    expect(size).toBeGreaterThanOrEqual(700) // extends to the gene end, not schematic fractions
    expect(parts[0]).toMatchObject({ id: 'P.m1', color: aaColor('TRP') }) // element keeps its tint
  })

  test('no gene part when the model has no resolved gene (no schematic ORF)', () => {
    const model = buildArchitecture(members, '+')
    const { parts } = toLinearMapProps(model, 'biosynthesis', 'lysW')
    expect(parts.some((p) => p.type === 'gene')).toBe(false)
    expect(parts.some((p) => p.id === DOWNSTREAM_ORF_ID)).toBe(false)
  })
})

describe('toLocusSequenceData — continuous locus track', () => {
  test('element bodies + features are shifted by each element offset; genes are chrome', () => {
    const members = [
      m({ id: 'P.m1', ordinal: 1, aa: 'ILE', leader: [1, 60], window: { tbox: [1, 60], codon: [10, 12], s1: [7, 20] } }),
      m({ id: 'P.m2', ordinal: 2, aa: 'LEU', leader: [1, 60], window: { tbox: [1, 60], codon: [10, 12], s1: [7, 20] } }),
    ]
    const data = toLocusSequenceData(members, ctx({
      seq: 'G'.repeat(400),
      elements: [{ member_id: 'P.m1', offset: 0, length: 60 }, { member_id: 'P.m2', offset: 100, length: 60 }],
      downstream_genes: [{ name: 'geneZ', protein_id: 'P9.1', locus_tag: null, offset: 200, length: 150, strand: '+', resolution: 'coded_by' }],
    }), 'biosynthesis')

    const byId = new Map(data.parts.map((p) => [p.id, p]))
    // element bodies: specifier-tinted + labelled "5′ (1) …" / "3′ (n) …" like the member-sequence view
    expect(byId.get('P.m1')).toMatchObject({ type: 'tbox', start: 0, end: 60, color: aaColor('ILE'), label: '5′ (1) ILE' })
    expect(byId.get('P.m2')).toMatchObject({ type: 'tbox', start: 100, end: 160, color: aaColor('LEU'), label: '3′ (2) LEU' })
    expect(byId.get('P.m2:codon')).toMatchObject({ start: 109, end: 112 }) // [10,12] → [9,12) + 100
    // SPECIFIER ONLY on the multi-element track: the Stem-I / antiterminator / terminator /
    // discriminator tags are dropped (they stay in the per-element toSequenceData view).
    expect(byId.has('P.m1:s1')).toBe(false)
    expect(data.parts.some((p) => ['s1', 'antiterm', 'term', 'discrim'].includes(p.type))).toBe(false)
    const gene = data.parts.find((p) => p.type === 'gene')!
    expect(gene).toMatchObject({ start: 200, end: 350, color: FUNC_CLASS_SHADE.biosynthesis })
    expect(data.translations).toEqual(
      expect.arrayContaining([
        { start: 9, end: 12, strand: 1, aminoAcids: 'I' },
        { start: 109, end: 112, strand: 1, aminoAcids: 'L' },
      ]),
    )
  })

  test('a single-element track keeps only the specifier (codon) tag, sharing toSequenceData geometry', () => {
    const member = m({ id: 'P.m1', ordinal: 1, aa: 'ILE', leader: [1, 60], window: { tbox: [1, 60], codon: [10, 12], s1: [7, 20] } })
    const c = ctx({ seq: member.fasta_sequence + 'GGGG', elements: [{ member_id: 'P.m1', offset: 0, length: member.fasta_sequence.length }] })
    const locus = toLocusSequenceData([member], c, 'biosynthesis')
    const single = toSequenceData(member)
    // the locus track drops every non-specifier tag, so its per-member feature parts are EXACTLY the
    // codon subset of the per-element view (same offsets at base 0); the codon translation is unchanged.
    const trackFeatures = locus.parts.filter((p) => p.id.startsWith('P.m1:'))
    expect(trackFeatures.map((p) => p.type)).toEqual(['codon'])
    expect(trackFeatures).toEqual(single.parts.filter((p) => p.type === 'codon'))
    expect(locus.translations).toEqual(single.translations)
  })

  test('real round-trip (+ strand, T0001): each element body is its tbox core at the stored offset', () => {
    const c = ctxT0001 as unknown as LocusContext
    const data = toLocusSequenceData(membersOf('T0001'), c, 'biosynthesis')
    expect(data.seq).toBe(c.seq)
    const offsetById = new Map(c.elements.map((e) => [e.member_id, e]))
    for (const mem of membersOf('T0001')) {
      // the interval seq still round-trips the FULL leader at the stored offset (the data contract)…
      const e = offsetById.get(mem.member_id)!
      expect(c.seq.slice(e.offset, e.offset + e.length)).toBe(mem.fasta_sequence)
      // …but the drawn body spans the tbox CORE (`bodyWindow`), shifted into the interval — exactly the
      // leader sliced to that window, NOT the whole leader.
      const [lo, hi] = bodyWindow(mem)
      const body = data.parts.find((p) => p.id === mem.member_id)!
      expect(body.start).toBe(e.offset + lo - 1)
      expect(body.end).toBe(e.offset + hi)
      expect(data.seq.slice(body.start, body.end)).toBe(mem.fasta_sequence.slice(lo - 1, hi))
    }
  })

  test('shared-leader T0342: the two members separate into distinct tbox cores (no stacked full-leader bands)', () => {
    const c = ctxT0342 as unknown as LocusContext
    const mems = membersOf('T0342').sort((a, b) => a.ordinal - b.ordinal)
    const data = toLocusSequenceData(mems, c, 'biosynthesis')
    const bodies = mems.map((mem) => data.parts.find((p) => p.id === mem.member_id)!)
    // Both members share one leader (same offset), so the OLD full-leader bands were identical. With
    // the tbox-core body they no longer fully overlap — the 5′ element's body ends before the 3′
    // element's begins (a real spacer), matching the architecture diagram.
    expect(bodies[0].start).not.toBe(bodies[1].start)
    expect(bodies[0].end).toBeLessThanOrEqual(bodies[1].start)
    expect(data.parts.some((p) => p.type === 'gene')).toBe(true)
  })

  test('the track body matches the architecture diagram body for every element (the views agree)', () => {
    // The crux of the fix: the seq-view body and the diagram body are the SAME extent. The diagram lays
    // bodies on a bio axis anchored at the 5′-most leader coord; the track shifts by the interval offset.
    // For loci whose genome coords match the assembly those two anchors coincide, so the bodies land at
    // identical bp (T0001/T0342 both round-trip byte-exactly — see complete-locus-view notes).
    for (const tid of ['T0001', 'T0342']) {
      const c = (tid === 'T0001' ? ctxT0001 : ctxT0342) as unknown as LocusContext
      const mems = membersOf(tid)
      const model = buildArchitecture(mems, c.strand, c)
      const data = toLocusSequenceData(mems, c, 'biosynthesis')
      for (const el of model.elements) {
        const body = data.parts.find((p) => p.id === el.member.member_id)!
        // diagram body [bodyStart, bodyEnd] (bp, inclusive) == track body [start, end) (half-open).
        expect(body.start).toBe(el.bodyStart)
        expect(body.end - 1).toBe(el.bodyEnd)
      }
    }
  })
})

describe('bodyWindow — the shared element-extent definition', () => {
  test('returns the tbox window when present and in range', () => {
    const mem = m({ id: 'B.m1', ordinal: 1, aa: 'TRP', leader: [1, 288], window: { tbox: [1, 238], term: [220, 260] } })
    expect(bodyWindow(mem)).toEqual([1, 238]) // tbox core, ~50 bp short of the 288 bp leader
  })

  test('falls back to the full leader when tbox is absent or runs off the 3′ end', () => {
    const noTbox = m({ id: 'B.m1', ordinal: 1, aa: 'TRP', leader: [1, 100], window: {} })
    expect(bodyWindow(noTbox)).toEqual([1, 100])
    const outOfRange = m({ id: 'B.m2', ordinal: 1, aa: 'TRP', leader: [1, 100], window: { tbox: [10, 150] } })
    expect(bodyWindow(outOfRange)).toEqual([1, 100])
  })
})
