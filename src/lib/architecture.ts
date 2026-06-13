// Tandem-architecture layout (PLAN §9①) — the pure geometry behind the signature
// view. Framework-agnostic so it is unit-tested at S2.7; `TandemArchitecture.svelte`
// renders the model over the vendored hatchlings LinearMap with an SVG glyph overlay
// (`architectureMap.ts` maps this model → LinearMap props; the overlay shares its bp→x).
//
// COORDINATE MODEL (the load-bearing bit).
// Each member carries leader-relative `window` offsets (1-based, alwaysascending)
// and genome-projected `genome` coords per feature. The window offset already runs
// BIOLOGICAL 5′→3′ for BOTH strands (offset 1 = the leader's 5′ end; verified on
// real data, e.g. T0342 minus-strand m1 window tbox[54,233] → genome[1984287,1984108]).
// To lay every element of a locus on ONE to-scale track we project genome coords to
// a common biological axis:
//   plus  strand:  bio(g) = g - gMin      (increasing genome coord = 5′→3′)
//   minus strand:  bio(g) = gMax - g      (transcript 5′ = the LARGER genome coord)
// so ordinal-1 (most-5′) always lands leftmost and the axis is in bp from the 5′
// origin. Within a member, window offset w maps to bio = bioLeaderStart + (w − 1)
// (1 window unit = 1 bp). This handles the 44 collapse-recovered "shared-leader"
// loci (both elements in one leader window) and the ordinary separate-leader loci
// uniformly — the inter-element spacer is just the bp gap between adjacent T-box
// bodies on this axis.

import type { FeatureName, LocusContext, Member, Span, Strand } from './data/types'

/** The per-element features drawn as distinct glyphs (the body = `tbox`, separate). */
export const ELEMENT_FEATURES: Exclude<FeatureName, 'tbox'>[] = [
  's1',
  's1_loop',
  'codon',
  'antiterm',
  'term',
  'discrim',
]

/** A feature's extent on the shared biological axis (bp from the locus 5′ origin). */
export interface FeatureBox {
  name: FeatureName
  /** `start ≤ end`, in bp on the biological-5′→3′ axis. */
  start: number
  end: number
}

/** One element (member) laid out on the locus track, biological 5′→3′. */
export interface ElementLayout {
  member: Member
  /** Transcript-5′ ordinal (1 = most-5′). */
  ordinal: number
  /** The element's own specifier AA (null → unknown); drives the body tint. */
  aa: string | null
  /** Element body (= the `tbox` span) on the biological axis. */
  bodyStart: number
  bodyEnd: number
  /** Present, valid feature glyphs keyed by name (missing/sentinel spans dropped). */
  features: Partial<Record<FeatureName, FeatureBox>>
}

/** A dashed inter-element spacer carrying its bp gap (PLAN §9①). */
export interface SpacerLayout {
  /** Signed bp between the upstream body end and the next body start; NEGATIVE when
   *  the two T-box bodies overlap / nest on the axis (~6% of loci have overlapping
   *  leader annotations — distinct from the collapse-recovered shared-leader set). */
  gap: number
  /** Upstream element's body end (bio axis). */
  start: number
  /** Next element's body start (bio axis); `< start` when the bodies overlap. */
  end: number
  /** True iff the bodies overlap/nest (`gap < 0`) — rendered as an explicit overlap
   *  marker, never silently as a clean tandem gap. */
  overlap: boolean
}

/** A downstream gene drawn TO SCALE on the element bio axis (from NCBI context). */
export interface GeneLayout {
  /** Gene body extent on the biological axis, `start ≤ end` (bp from the 5′ origin). */
  start: number
  end: number
  /** True iff the gene reads in the locus transcription direction (co-oriented). */
  coOriented: boolean
  /** Display label (gene symbol / locus tag); chrome-coloured, never a specifier hue. */
  label: string | null
}

/** The full to-scale layout of one locus's tandem architecture. */
export interface ArchitectureModel {
  strand: Strand
  /** Domain max of the biological axis (bp); the scale runs [0, span]. */
  span: number
  /** Elements in biological 5′→3′ (ordinal) order. */
  elements: ElementLayout[]
  /** Spacers between consecutive elements (length = elements.length − 1). */
  spacers: SpacerLayout[]
  /** Bio coordinate of the 3′-most element body end. */
  threePrimeEnd: number
  /** Downstream operon genes drawn TO SCALE (real NCBI coords), proximal-first; present
   *  only when a `LocusContext` with resolved genes was supplied. The context's interval
   *  shares the element bio frame (both anchored at the 5′-most genome coord), so a gene's
   *  0-based seq `offset` is directly its bio coordinate. Absent → no gene is drawn (the
   *  figure shows the elements alone + a "gene could not be found" banner; see
   *  `toLinearMapProps`), never a schematic stand-in. */
  genes?: GeneLayout[]
  /** True iff the figure was built from real NCBI context (≥1 gene to scale). */
  toScale: boolean
}

/**
 * Coerce a leader-relative `window` span to an ascending `[lo, hi]`, or null when
 * the feature is absent. A null end, or a sub-1 offset (the build's 0/`[0,2]`
 * "missing" sentinel, e.g. T0003 m1's discriminator), means "not drawable".
 */
export function validSpan(span: Span | undefined): [number, number] | null {
  if (!span) return null
  const [a, b] = span
  if (a === null || b === null) return null
  if (a < 1 || b < 1) return null
  return a <= b ? [a, b] : [b, a]
}

/** Leader length in bp = |locus_end − locus_start| + 1 (gate #5: == fasta length). */
export function leaderLength(member: Member): number {
  const [a, b] = member.coords.leader
  return Math.abs(b - a) + 1
}

/**
 * THE single definition of an element's drawn extent, 1-based inclusive into the
 * leader: the `tbox` feature window (the T-box riboswitch core — Stem I → the
 * antiterminator/discriminator), falling back to the full leader `[1, leaderLen]`
 * when `tbox` is absent or runs off the leader's 3′ end (same out-of-range guard as
 * `featureSpans`). The `tbox` annotation stops short of the leader's 3′ end (the
 * terminator-hairpin tail lies OUTSIDE it — e.g. T0018.m1 `tbox = [1, 238]` over a
 * 288 bp leader), so the body is ~50 bp narrower than the full leader.
 *
 * Both the architecture diagram (this body projected to the bio axis) AND the
 * full-locus sequence track (this body shifted by the element's interval offset) read
 * the SAME window, so the two views draw the element at the same extent and agree on
 * the inter-element spacers / overlaps — and the shared-leader loci (both members in
 * one leader window) separate into their two distinct cores instead of stacking as
 * two identical full-leader bands.
 */
export function bodyWindow(member: Member): [number, number] {
  const leaderLen = leaderLength(member)
  const tbox = validSpan(member.coords.window.tbox)
  if (tbox && tbox[1] <= leaderLen) return tbox
  return [1, leaderLen]
}

/**
 * Project a locus's members onto one to-scale, biological-5′→3′ track (PLAN §9①).
 * `members` need not be pre-sorted; the result is ordinal-ordered.
 *
 * When a `LocusContext` (the NCBI genomic context) is supplied AND it resolved ≥1
 * downstream gene, each operon gene is added TO SCALE. The context's interval is anchored
 * at the same 5′-most genome coordinate as the element bio axis, so a gene's 0-based seq
 * `offset` is directly its bio coordinate (no reconciliation needed). With no context (or
 * an unresolved one) the model is byte-identical to the 2-arg call — `genes` is absent and
 * `toScale` is false, so `toLinearMapProps` draws no gene (the figure shows the elements
 * alone + the "gene could not be found" banner).
 */
export function buildArchitecture(
  members: Member[],
  strand: Strand,
  context?: LocusContext | null,
): ArchitectureModel {
  const sorted = [...members].sort((a, b) => a.ordinal - b.ordinal)

  // Common biological axis from every leader endpoint (features stay within them).
  const leaderCoords: number[] = []
  for (const m of sorted) leaderCoords.push(m.coords.leader[0], m.coords.leader[1])
  const gMin = Math.min(...leaderCoords)
  const gMax = Math.max(...leaderCoords)
  const span = gMax - gMin
  const bioPos = strand === '+' ? (g: number) => g - gMin : (g: number) => gMax - g

  const elements: ElementLayout[] = sorted.map((member) => {
    // leader[0] = locus_start = the biological-5′ genome coord → leftmost on the axis.
    const bioLeaderStart = bioPos(member.coords.leader[0])
    const toBio = (offset: number) => bioLeaderStart + (offset - 1)
    const leaderLen = leaderLength(member) // == fasta_sequence.length (gate #5)

    const featBox = (name: FeatureName): FeatureBox | null => {
      const v = validSpan(member.coords.window[name])
      // DROP a window that runs off the leader's 3′ end rather than rely on the d3
      // `.clamp(true)` scale — matching the build's `seq[lo-1:hi]` guard and
      // `sequence.ts` featureSpans (which return None/absent when `hi > len`). So a
      // corrupt/out-of-range window (e.g. T0299.m2's `term = [153, 143]` over a
      // 143 bp leader) yields NO glyph instead of a clamped one pinned at the body
      // edge. (`tbox` is always in range on real data; if it weren't, the body
      // falls back to the full leader, exactly as for an absent tbox.)
      if (!v || v[1] > leaderLen) return null
      return { name, start: toBio(v[0]), end: toBio(v[1]) }
    }

    // The element body is the shared `bodyWindow` (tbox core, or full-leader fallback)
    // projected to the bio axis — the SAME window the full-locus sequence track uses, so
    // the diagram and the track agree on the body extent and the spacers/overlaps.
    const [bodyLo, bodyHi] = bodyWindow(member)
    const bodyStart = toBio(bodyLo)
    const bodyEnd = toBio(bodyHi)

    const features: Partial<Record<FeatureName, FeatureBox>> = {}
    for (const name of ELEMENT_FEATURES) {
      const box = featBox(name)
      if (box) features[name] = box
    }

    return { member, ordinal: member.ordinal, aa: member.specifier.aa, bodyStart, bodyEnd, features }
  })

  const spacers: SpacerLayout[] = []
  for (let i = 0; i < elements.length - 1; i++) {
    const start = elements[i].bodyEnd
    const end = elements[i + 1].bodyStart
    const gap = end - start - 1
    spacers.push({ gap, start, end, overlap: gap < 0 })
  }

  const threePrimeEnd = Math.max(...elements.map((e) => e.bodyEnd))

  // Downstream operon genes to scale (real NCBI coords), when context resolved them. A
  // gene's 0-based seq offset is its bio coordinate (same frame as the elements); we keep
  // only genes that lie within the fetched interval (the pipeline already guarantees this,
  // but guard defensively so a malformed context yields no gene — the elements alone + the
  // banner — rather than drawing off-axis).
  let genes: GeneLayout[] | undefined
  let toScale = false
  if (context && context.resolved && context.seq.length > 0 && context.downstream_genes.length > 0) {
    const within = context.downstream_genes.filter(
      (g) => g.offset >= 0 && g.offset + g.length <= context.seq.length,
    )
    if (within.length > 0) {
      genes = within.map((g) => ({
        start: g.offset,
        end: g.offset + g.length,
        coOriented: g.strand === strand,
        label: g.name,
      }))
      toScale = true
    }
  }

  return { strand, span, elements, spacers, threePrimeEnd, genes, toScale }
}

/** True iff two members occupy the identical leader window — the 44 collapse-
 *  recovered loci, whose pairwise leader %-identity saturates at 100 (PLAN §5.1;
 *  PROGRESS S0.5). The element-comparison panel flags this so 100% is not misread
 *  as element-vs-element divergence. */
export function sharesLeader(a: Member, b: Member): boolean {
  return a.coords.leader[0] === b.coords.leader[0] && a.coords.leader[1] === b.coords.leader[1]
}
