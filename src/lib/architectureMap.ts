// Pure adapters from the tandem-architecture model (`architecture.ts`) and a member
// (`data/types.ts`) to the data shapes the vendored hatchlings LinearMap and the published
// SequenceViewer consume. Framework-agnostic and unit-tested — no DOM, no Svelte.
//
// TWO COORDINATE CONVENTIONS, on purpose:
//   • LinearMap is a genomic feature track: `bpToX(bp) = MARGIN + (bp/size)*(width-2·MARGIN)` over
//     a bio-axis domain [0, size]. We pass each element body's bio-axis bp through unchanged.
//   • SequenceViewer is a character grid: parts are 0-based, half-open `[start, end)` indices into
//     `seq` (rows slice `seq.slice(i, i+charsPerRow)`; the ruler displays `pos+1`). A 1-based,
//     inclusive leader window `[lo, hi]` therefore maps to `{ start: lo-1, end: hi }`.

import type { ArchitectureModel } from './architecture'
import { bodyWindow } from './architecture'
import type { FuncClass, LocusContext, Member } from './data/types'
import type { Part, SequenceData, Translation } from './vendor/hatchlings'
import { LINEAR_MARGIN_LEFT, LINEAR_MARGIN_RIGHT } from './vendor/hatchlings/util/layout'
import { STEM_COLORS, TERMINATOR_COLOR, FUNC_CLASS_SHADE, aaColor } from './color'
import { featureSpans, ordinalLabel, FEATURE_LABEL, HIGHLIGHT_FEATURES, type HighlightFeature } from './sequence'

/** Stable id for the downstream-gene part (so the overlay/click handling can find it). */
export const DOWNSTREAM_ORF_ID = 'downstream-orf'

/** Right-margin padding past the 3′-most drawn feature, so the figure never runs to the edge. */
const AXIS_PAD_FRAC = 0.02
const AXIS_PAD_MIN = 4

/** Pure mirror of the vendored LinearMap's internal `bpToX` (same margins, same divide-by-zero
 *  guard). The glyph overlay projects with THIS so it stays pixel-aligned to the strip. */
export function linearMapBpToX(bp: number, size: number, width: number): number {
  if (size <= 0) return LINEAR_MARGIN_LEFT
  const backboneWidth = width - LINEAR_MARGIN_LEFT - LINEAR_MARGIN_RIGHT
  return LINEAR_MARGIN_LEFT + (bp / size) * backboneWidth
}

/**
 * Architecture model → LinearMap props: one feature arrow per T-box element body (tinted by its
 * own specifier), plus the downstream gene(s) when NCBI resolved them. The genes are drawn TO
 * SCALE (chrome-coloured, co-orientation honoured); when the locus's gene could NOT be located on
 * the leader's molecule, NO gene arrow is drawn — the figure shows the T-box elements alone and
 * `TandemArchitecture` surfaces a "downstream gene could not be found" banner (there is no
 * schematic-ORF fallback). All on a single forward lane (the strip is rendered with `noStack`),
 * bio-axis bp passed through unchanged.
 */
export function toLinearMapProps(
  model: ArchitectureModel,
  funcClass: FuncClass,
  downstreamGene: string | null,
): { size: number; parts: Part[] } {
  const span = Math.max(model.span, 1)
  const pad = Math.max(AXIS_PAD_MIN, Math.round(span * AXIS_PAD_FRAC))

  const parts: Part[] = model.elements.map((el) => ({
    id: el.member.member_id,
    name: el.aa ?? 'T-box',
    type: 'tbox',
    start: el.bodyStart,
    end: el.bodyEnd,
    strand: 1,
    color: aaColor(el.aa), // the specifier hue IS the data-colour oracle (chrome⟂data)
    label: el.aa ?? undefined,
  }))

  if (model.genes && model.genes.length > 0) {
    // To scale: one chrome arrow per resolved operon gene at its real bio coords. The proximal
    // gene keeps DOWNSTREAM_ORF_ID (so click/overlay handling that special-cases it still works);
    // additional operon genes get suffixed ids. Co-orientation flips the arrow.
    model.genes.forEach((g, i) => {
      parts.push({
        id: i === 0 ? DOWNSTREAM_ORF_ID : `${DOWNSTREAM_ORF_ID}-${i + 1}`,
        name: g.label ?? downstreamGene ?? funcClass,
        type: 'gene',
        start: g.start,
        end: g.end,
        strand: g.coOriented ? 1 : -1,
        color: FUNC_CLASS_SHADE[funcClass], // chrome, never a specifier hue
        label: g.label ?? downstreamGene ?? funcClass,
      })
    })
    const maxGeneEnd = Math.max(model.threePrimeEnd, ...model.genes.map((g) => g.end))
    return { size: maxGeneEnd + pad, parts }
  }

  // Gene unresolved: the elements alone (no schematic ORF). The axis spans just the leaders.
  return { size: Math.max(model.threePrimeEnd, span) + pad, parts }
}

/** Palette for the per-feature annotation arrows in the sequence view (codon handled separately). */
const FEATURE_SEQ_COLOR: Record<Exclude<HighlightFeature, 'codon'>, string> = {
  s1: STEM_COLORS.i, // Stem I
  antiterm: STEM_COLORS.at, // antiterminator helix
  term: TERMINATOR_COLOR, // terminator hairpin
  discrim: STEM_COLORS.at, // discriminator sits in the antiterminator region
}

/** Three-letter → one-letter amino-acid code, for the specifier-codon translation track. */
const AA_THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H',
  ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W',
  TYR: 'Y', VAL: 'V',
}

/**
 * One member's feature annotation parts + specifier-codon translation, shifted by `baseOffset`
 * (0 for a single-member view; the element's offset within the locus interval for the continuous
 * locus track). 1-based inclusive leader windows convert to 0-based half-open `[start, end)`. The
 * SINGLE source both `toSequenceData` and `toLocusSequenceData` build from, so the two never drift.
 * `features` restricts which annotation tags are emitted: the per-element view shows every window,
 * while the multi-element locus track passes `['codon']` so only the specifier tag rides the track
 * (Stem-I / antiterminator / terminator / discriminator would be up to ~30 overlapping tags across
 * six elements). The specifier-codon translation is independent of the subset — it is the specifier.
 */
function memberFeatureParts(
  member: Member,
  baseOffset: number,
  features: readonly HighlightFeature[] = HIGHLIGHT_FEATURES,
): { parts: Part[]; translations: Translation[] } {
  const spans = featureSpans(member) // Partial<Record<HighlightFeature, [lo, hi]>>, 1-based inclusive
  const parts: Part[] = []
  for (const name of features) {
    const span = spans[name]
    if (!span) continue
    const [lo, hi] = span
    parts.push({
      id: `${member.member_id}:${name}`,
      name: FEATURE_LABEL[name],
      type: name,
      start: lo - 1 + baseOffset, // 1-based inclusive → 0-based inclusive, shifted to the track
      end: hi + baseOffset, // 0-based exclusive (== 1-based inclusive hi)
      strand: 1,
      color: name === 'codon' ? aaColor(member.specifier.aa) : FEATURE_SEQ_COLOR[name],
      label: FEATURE_LABEL[name],
    })
  }

  const translations: Translation[] = []
  const codon = spans.codon
  const one = member.specifier.aa ? AA_THREE_TO_ONE[member.specifier.aa.trim().toUpperCase()] : undefined
  if (codon && one) {
    translations.push({ start: codon[0] - 1 + baseOffset, end: codon[1] + baseOffset, strand: 1, aminoAcids: one })
  }

  return { parts, translations }
}

/**
 * Member → SequenceViewer data: the gap-free leader (shown as RNA) with one annotation arrow per
 * present feature window, and — when the specifier amino acid is a known single residue — a
 * one-codon translation over the specifier codon. Offsets are converted 1-based→0-based here.
 */
export function toSequenceData(member: Member): SequenceData {
  const { parts, translations } = memberFeatureParts(member, 0)
  return {
    seq: member.fasta_sequence,
    parts,
    cutSites: [],
    translations,
    alphabet: 'rna',
    topology: 'linear',
  }
}

/**
 * The WHOLE locus as one continuous SequenceViewer track (PLAN §9 — "all elements together"):
 * the NCBI interval sequence (transcription-5′→3′), annotated with, per element, a specifier-tinted
 * body part + its codon translation (re-projected by the element's interval offset), plus a chrome
 * arrow per downstream gene. Because the interval seq round-trips each member's `fasta_sequence` at
 * its stored offset, the per-element features land exactly. Elements absent from the context
 * (defensive) are skipped.
 *
 * The body part spans the shared `bodyWindow` (the `tbox` core — the SAME extent the architecture
 * diagram draws), NOT the full leader, so the track and the diagram agree on where each element
 * sits and on the inter-element spacers / overlaps. (Drawing the full leader instead made the two
 * views disagree: the leader is ~50 bp wider than the tbox core, which flipped clean gaps in the
 * diagram into apparent overlaps on the track and stacked the 44 shared-leader loci's two members
 * as identical full-length bands.)
 */
export function toLocusSequenceData(
  members: Member[],
  context: LocusContext,
  funcClass: FuncClass,
): SequenceData {
  const offsetById = new Map(context.elements.map((e) => [e.member_id, e.offset]))
  const sorted = [...members].sort((a, b) => a.ordinal - b.ordinal)
  const n = sorted.length
  const parts: Part[] = []
  const translations: Translation[] = []

  for (const member of sorted) {
    const base = offsetById.get(member.member_id)
    if (base === undefined) continue
    // the element body (specifier-tinted) — the one place the data hue appears on the track. Labelled
    // exactly like the member-sequence / element-comparison views ("5′ (1) LYS" … "3′ (n) …") since the
    // locus track shows every element of the locus at once (up to six). The body spans the tbox core
    // (`bodyWindow`, the diagram's extent), shifted by `base` into the interval: a 1-based inclusive
    // window [lo, hi] → 0-based half-open [base+lo-1, base+hi).
    const aaLabel = member.specifier.aa ?? '?'
    const [bodyLo, bodyHi] = bodyWindow(member)
    parts.push({
      id: member.member_id,
      name: `${ordinalLabel(member.ordinal, n)} ${aaLabel}`,
      type: 'tbox',
      start: base + bodyLo - 1,
      end: base + bodyHi,
      strand: 1,
      color: aaColor(member.specifier.aa),
      label: `${ordinalLabel(member.ordinal, n)} ${aaLabel}`,
    })
    // Specifier only on the multi-element track — drop the Stem-I / antiterminator / terminator /
    // discriminator tags (kept in the per-element view via toSequenceData's full subset).
    const { parts: fParts, translations: fTr } = memberFeatureParts(member, base, ['codon'])
    parts.push(...fParts)
    translations.push(...fTr)
  }

  for (const g of context.downstream_genes) {
    parts.push({
      id: `gene:${g.protein_id ?? g.locus_tag ?? g.offset}`,
      name: g.name ?? 'downstream gene',
      type: 'gene',
      start: g.offset,
      end: g.offset + g.length,
      strand: g.strand === context.strand ? 1 : -1,
      color: FUNC_CLASS_SHADE[funcClass], // chrome, never a specifier hue
      label: g.name ?? 'gene',
    })
  }

  return {
    seq: context.seq,
    parts,
    cutSites: [],
    translations,
    alphabet: 'rna',
    topology: 'linear',
  }
}
