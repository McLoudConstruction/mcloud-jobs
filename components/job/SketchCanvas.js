'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { staffName } from '@/lib/userDisplay';
import {
  AREA_KINDS, MARK_COLORS, MAX_MARKS, MAX_ROOMS, MAX_AREAS, MAX_SOURCES, MIN_ROOM, MAX_ROOM, ROOM_TYPES, SURFACES, WALL_HEIGHTS, WATER_CATS,
  addCornerCut, affectedTotals, carveRooms, cleanSurfaces, cleanWater, dropStraightPoints, edgeLength, fitView, heightFor, hitMarkAt, hitRoom, hitSource,
  ensureRoomNums, insertBreak, isRect, pointInPoly, polyBox, roomTitle, makeId, moveEdgeSnapped, moveVertex, nearestAnchor, nearestEdge, nearestVertex, newArea, newRoom, newSource, normalizePlan, placeGrowth,
  parseFeet, pickArea, planBounds, rectPts, removeVertex, resizeRect, roomAreaText, roomBox, roomSizeText, setEdgeLength,
  simplifyStroke, snap, snapOnEdge, surfaceText, tidyPts, toScreen, toWorld, totalArea, translatePts, fmtFeet,
  FLOOR_TYPES, MIN_CEIL, MAX_CEIL, cleanCeil, roomArea,
} from '@/lib/sketch';
import { turnRoomPts, placeBox } from '@/lib/roomShapes';
import { openingPlace, placeOpeningAt, sharedWallMismatches, snapToNeighbour, translateRoom } from '@/lib/measure';
import RoomTrace from '@/components/job/RoomTrace';
import { hasFeature, areaKindsFor } from '@/lib/services';
import RoomBySize from '@/components/job/RoomBySize';
import EquipmentSizing from '@/components/job/EquipmentSizing';
import DehuReadings from '@/components/job/DehuReadings';
import MeterScan from '@/components/job/MeterScan';
import AssetScan from '@/components/job/AssetScan';
import { checkScannedAsset } from '@/lib/assetScan';
import PullPrompt from '@/components/job/PullPrompt';
import DayOneList, { useDayOne } from '@/components/job/DayOneList';
import { drawPlan, areaStyle, WATER_LINE } from '@/lib/sketchDraw';
import {
  MAX_MOISTURE, MAX_READINGS, MOISTURE_COLORS, MOISTURE_MATERIALS, MOISTURE_SURFACES, MOISTURE_TYPES, POINT_KINDS, TREND_MARK,
  airText, fmtReading, goalFor, gpp, hitMoisture, makeMoisture, makeReading, measuredStandard, moistureCounts, moistureStatus, nextNumber, padEdit, parseReading, sortedReadings, valueText, readingPhotoKey,
} from '@/lib/moisture';
import { OBJECT_TYPES, OBJECT_GROUPS, MAX_OBJECTS, makeObject, objectCounts, isInches, inchesText, parseInches } from '@/lib/objectTypes';
import { placeObject, hitObject, nearestWall, wallSpan } from '@/lib/sketchObjects';
import { jpegToPdf } from '@/lib/pdfImage';
import { moistureLogCsv, moistureSummaryCsv } from '@/lib/moistureLog';
import { buildMoistureReportPdf } from '@/lib/reportExport';
import { addDay, atForDay, countOnDay, dateText, dayName, dayView, pointTimeline, removeDay, todayKey } from '@/lib/moistureDays';
import { areaLayers } from '@/lib/moistureLayers';
import {
  EQUIPMENT_GROUPS, EQUIPMENT_ORDER, EQUIPMENT_TYPES, MAX_EQUIPMENT, countText, daysOnSite, equipmentActionsOnDay, equipmentCounts, equipmentOnPlan, equipmentOnSite,
  hitEquipment, makeEquipment, moveUnit, nextEquipNumber, pickUpUnit, placementSpots, putBackUnit, unitAt, unitCode, MAX_PLACE_AT_ONCE,
} from '@/lib/equipment';
import { buildEquipment, equipmentLogCsv, unitHistory } from '@/lib/equipmentLog';
import { equipmentLabelsPdf } from '@/lib/equipmentLabels';
import { hitComment, tagsFromText, segments, timeAgo, logEntry, withLog, canDeleteComment, activity, MAX_COMMENTS, MAX_REPLIES } from '@/lib/sketchComments';
import MentionBox from '@/components/job/MentionBox';

const TOOLS = [
  ['select', 'Select', 'V'],
  ['pan', 'Pan', 'Space'],
  ['room', 'Room', 'R'],
  ['break', 'Wall break', 'B'],
  ['corner', 'Corner', 'C'],
  ['missing', 'Missing wall', 'M'],
  ['area', 'Affected areas', 'W'],
  ['object', 'Objects', 'O'],
  ['text', 'Text', 'T'],
  ['comment', 'Comment', 'K'],
];
const KEYS = { v: 'select', r: 'room', b: 'break', c: 'corner', m: 'missing', w: 'area', o: 'object', t: 'text', k: 'comment' };
const HINTS = {
  select: 'Click a room to select it. Drag a wall to slide it along its neighbours, or drag a corner to make an angle. Hold Ctrl and drag a corner or wall to start a new room there. Double-click a corner, or press Delete with it selected, to remove it.',
  missing: 'Click a wall to mark all of it as missing (open to the next space), or drag along a wall to mark just that stretch. Click a missing wall with Select to change or delete it.',
  pan: 'Drag to move around. Pinch or scroll to zoom. From any tool, hold Space and drag to pan, then let go to carry on.',
  room: 'Drag on the sketch to draw a room. It snaps to the corners and walls of rooms already there.',
  break: 'Hover a wall and click to cut it in two. Switch to Select (V), then drag either side of the cut in or out.',
  corner: 'Hover a wall and click to add a corner. To cut off a corner of a room, click one wall, then click the wall next to it. The tool stays on, so keep clicking. Esc starts over.',
  area: 'Pick what to mark and which surfaces it is on, then draw around it. It is cleaned up when you let go.',
  object: 'Pick an object, then click to place it. Doors, windows and outlets snap to the wall; cabinets and fixtures sit flush against it. Hold Alt to place freely. Esc stops. Click one with Select to edit it.',
  equipment: 'Pick the kind of equipment, tap a room to zoom in, then tap where it goes. Tap a unit to move it, pick it up or change it. Use the Day button for another day: where a unit stood on that day is kept.',
  moisture: 'Tap a room to zoom in, then tap where the reading was taken and type it. Use the Day button to start a new day of readings; tap a pin to add that day\'s reading at the spot.',
  text: 'Tap where the note should go, then type it.',
  comment: 'Tap the spot the comment is about, then type. Type @ to tag a teammate. Tap a comment pin to read, reply or resolve it.',
};
const AREA_HINTS = {
  water: 'Draw around where the water went. Choose the surfaces it reached.',
  growth: 'Draw a line along a wall, or a loop for the ceiling. It snaps to the nearest one. Choose Manual or hold Alt to place it freely.',
  smoke: 'Draw around what the smoke reached. Choose the surfaces it is on.',
  source: 'Tap where the loss started.',
};
const SURFACE_VIEWS = [['all', 'All surfaces'], ['floor', 'Floor'], ['wall', 'Walls'], ['ceiling', 'Ceiling']];
const KIND_ORDER = ['water', 'source', 'growth', 'smoke'];
const kindDot = (kind) => areaStyle({ kind, cat: 2 }).line;
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const inField = (el) => {
  const tag = (el?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable;
};

function SurfaceChips({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="Surfaces">
      {Object.entries(SURFACES).map(([k, label]) => (
        <button key={k} type="button" className={value.includes(k) ? 'on' : ''} aria-pressed={value.includes(k)}
          onClick={() => { const next = value.includes(k) ? value.filter((x) => x !== k) : [...value, k]; if (next.length) onChange(cleanSurfaces(next)); }}>{label}</button>
      ))}
    </div>
  );
}
function SurfacePick({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="Surface the reading is on">
      {Object.entries(MOISTURE_SURFACES).map(([k, label]) => (
        <button key={k} type="button" className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}
function NumBox({ label, value, placeholder, unit, active, big, onPick }) {
  return (
    <button type="button" className={`sk-num${big ? ' big' : ''}${active ? ' on' : ''}`} aria-pressed={active} aria-label={`${label}${value ? ` ${value}` : ' (empty)'}`} onClick={onPick}>
      <span className="sk-num-label">{label}</span>
      <span className={`sk-num-val${value ? '' : ' ph'}`}>{value || placeholder}{active && <span className="sk-cursor" aria-hidden="true" />}</span>
      {unit && <span className="sk-num-unit">{unit}</span>}
    </button>
  );
}
const whenText = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function CatChips({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="Water category">
      {[1, 2, 3].map((n) => (
        <button key={n} type="button" className={value === n ? 'on' : ''} aria-pressed={value === n} title={WATER_CATS[n]} onClick={() => onChange(n)}>
          <span className="sk-dot" style={{ background: WATER_LINE[n] }} />Cat {n}
        </button>
      ))}
    </div>
  );
}
function HeightChips({ value, onChange }) {
  return (
    <div className="chips" role="group" aria-label="How high up the wall">
      {WALL_HEIGHTS.map((h) => (
        <button key={h} type="button" className={value === h ? 'on' : ''} aria-pressed={value === h} onClick={() => onChange(h)}>{h === 8 ? 'Full' : `${h}'`}</button>
      ))}
    </div>
  );
}
const FullIcon = ({ on }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {on ? <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" /> : <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />}
  </svg>
);

const Ico = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const UploadIcon = () => <Ico><path d="M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10v3h11v-3" /></Ico>;
const UndoIcon = () => <Ico><path d="M5.5 3L2.5 6l3 3M2.8 6H9a4 4 0 0 1 0 8H6" /></Ico>;
const RedoIcon = () => <Ico><path d="M10.5 3l3 3-3 3M13.2 6H7a4 4 0 0 0 0 8h3" /></Ico>;
const PlusIcon = () => <Ico><path d="M8 3v10M3 8h10" /></Ico>;
const MinusIcon = () => <Ico><path d="M3 8h10" /></Ico>;
const FitIcon = () => <Ico><rect x="3.5" y="3.5" width="9" height="9" rx="1" /><path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11" /></Ico>;

// The drawing board. Works in feet. The parent owns saving: onChange gets the whole new plan after
// each finished change. The plan prop is read once (the parent remounts this with a new key to
// switch sketches).
function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ verticalAlign: '-4px' }}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6l1.8 1.8L8 4.5M3 12.5l1.8 1.8L8 11M3 19l1.8 1.8L8 17.5" /><path d="M12 6h9M12 12.5h9M12 19h9" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 12.5l9 5 9-5" /><path d="M3 17l9 5 9-5" />
    </svg>
  );
}

function DockIcon({ k }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (k === 'select') return <svg {...common}><path d="M5 3l14 8-6 2-2 6z" /></svg>;
  if (k === 'room') return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="1" /></svg>;
  if (k === 'add') return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (k === 'undo') return <svg {...common}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>;
  return <svg {...common}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>;
}

const MOVE_STEP = 0.5; // feet: the Move arrows slide a room 6 inches at a time

// a finger is the pointer: phones, and tablets that report a coarse pointer
const coarse = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false);

export default function SketchCanvas({ variant = 'sketch', plan: initialPlan, onChange, photoCounts = {}, onAddRoomPhoto, onViewRoomPhotos, onAddReadingPhoto = null, onViewReadingPhotos = null, reportInfo = null, onQuoteRoom = null, exportName = 'sketch', headSlot = null, staff = null, staffList = [], onComment = null, command = null, onCommandDone = null, assets = null, service = '', equipGate = null, onEquipBlocked = null }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rootRef = useRef(null);
  const planRef = useRef(normalizePlan(initialPlan));
  const totalsRef = useRef({ plan: null, totals: { rooms: {}, total: {} } });
  const popRef = useRef(null);
  const viewRef = useRef({ scale: 14, ox: 40, oy: 40 });
  const dragRef = useRef(null);      // gesture in progress: { mode, plan?, draft?, ... }
  const hoverRef = useRef(null);
  const spaceRef = useRef(null); // while Space is held: { back } the tool to return to
  const lastCornerRef = useRef(null); // Add corner: the point the last click added, { roomId, x, y }
  const pointers = useRef(new Map());
  const undoRef = useRef([]);
  const freshRef = useRef(null); // a point just dropped on the initial loss and not saved yet: { id, undoLen }
  const redoRef = useRef([]);
  const sizeRef = useRef({ W: 300, H: 400 });
  const countsRef = useRef(photoCounts);
  const rafRef = useRef(0);

  const [tool, setTool] = useState(variant === 'moisture' ? 'moisture' : 'select');
  const [sel, setSel] = useState(null); // { kind: 'room' | 'mark' | 'area' | 'source', id, vi?, ei? }
  const [color, setColor] = useState(MARK_COLORS[0]);
  const [areaKind, setAreaKind] = useState('water'); // what the Affected areas tool is marking
  const [waterCat, setWaterCat] = useState(1);
  const [growthAuto, setGrowthAuto] = useState(true); // Growth: lines snap to a wall, loops to a ceiling
  const [areaMode, setAreaMode] = useState('smooth');
  const [surfaces, setSurfaces] = useState(['floor']); // surfaces for the next thing drawn
  const [wallHeight, setWallHeight] = useState(2);
  const [surfaceView, setSurfaceView] = useState('all'); // which surface to show: all, floor, wall, ceiling
  const [moist, setMoist] = useState(() => { // what the next moisture point is: like the last point placed, or edited, on this plan
    const last = [...((initialPlan && initialPlan.moisture) || [])].reverse().find((m) => m.kind !== 'air' && m.kind !== 'standard' && m.surface && m.material && m.type);
    return last ? { surface: last.surface, material: last.material, type: last.type } : { surface: 'floor', material: 'drywall', type: 'mc' };
  });
  const [moistLabels, setMoistLabels] = useState(true); // show the reading beside each moisture pin
  const [rd, setRd] = useState({ val: '', note: '' }); // the reading being typed
  const [air, setAir] = useState({ rh: '', temp: '' }); // humidity and temperature carry over to the next reading: the air is the same
  const [rdErr, setRdErr] = useState('');
  const [dayOneOpen, setDayOneOpen] = useState(false);
  const [stdOpen, setStdOpen] = useState(false); // the dry standards list
  const mode = variant === 'moisture' ? 'moisture' : 'draw'; // the Sketch tab draws; the Moisture tab logs readings on a plain floorplan and leaves the drawing alone
  const [hidden, setHidden] = useState(() => new Set()); // moisture floorplan: affected-area layers switched off
  const [showPins, setShowPins] = useState(true);
  const [dayId, setDayId] = useState(null); // moisture floorplan: the day being viewed and logged
  const [dayOpen, setDayOpen] = useState(false);
  const [recheck, setRecheck] = useState(null); // id of the day being rechecked: the tech is in "recheck mode" until they tap Finish
  const [recheckDone, setRecheckDone] = useState(null); // { name, read, total } shown after Finish recheck
  const [rcNote, setRcNote] = useState(''); // why a recheck asked for from outside (the phone's action button) did not start
  const [newDate, setNewDate] = useState(() => todayKey());
  const dayRef = useRef(null);
  const dvRef = useRef({ src: null, day: null, out: null });
  const [focusId, setFocusId] = useState(null); // moisture floorplan: the room zoomed into, the rest greyed out
  const focusRef = useRef(null);
  focusRef.current = focusId;
  const [layersOpen, setLayersOpen] = useState(false);
  const [showEquip, setShowEquip] = useState(true);
  const layerRef = useRef({ hidden: new Set(), pins: true, equip: true });
  layerRef.current = { hidden, pins: showPins, equip: showEquip };
  const [moveId, setMoveId] = useState(null); // a moisture point waiting to be put somewhere else
  const [work, setWork] = useState('readings'); // moisture floorplan: what a tap does: log a reading, or place equipment
  const workRef = useRef('readings');
  workRef.current = work;
  const [eqType, setEqType] = useState('airmover'); // what the next unit of equipment placed is
  const eqTypeRef = useRef('airmover');
  eqTypeRef.current = eqType;
  const [eqQty, setEqQty] = useState(1); // quantity box: how many units one tap places
  const eqQtyRef = useRef(1);
  eqQtyRef.current = eqQty;
  const [moveEqId, setMoveEqId] = useState(null); // a unit of equipment waiting to be put somewhere else
  const moveEqRef = useRef(null);
  moveEqRef.current = moveEqId;
  const [eqListOpen, setEqListOpen] = useState(false); // the list of what is on site
  const [sizeOpen, setSizeOpen] = useState(false); // the add-a-room-by-size dialog
  const [eqNote, setEqNote] = useState(''); // "AM 3 placed in Kitchen", for a moment
  const [scanFor, setScanFor] = useState(null); // the unit whose asset tag is being scanned with the camera
  const [kb, setKb] = useState(0); // how far the phone keyboard covers the bottom of the sketch, in pixels
  const [vvBox, setVvBox] = useState(null); // the part of the screen the phone keyboard leaves free: { top, height }
  const [numField, setNumField] = useState('val'); // which of Reading / RH / Temp the number pad types into
  const [menuOpen, setMenuOpen] = useState(false);
  const [popH, setPopH] = useState(320); // measured height of the open popup, so it can be kept on the sketch
  const [objMenu, setObjMenu] = useState(false);
  const [objMenuPos, setObjMenuPos] = useState(null); // where the wide Objects menu sits, in screen pixels
  const [objType, setObjType] = useState('door'); // what the Objects tool places
  const ghostRef = useRef(null); // Objects tool: the preview under the pointer
  const [traceOpen, setTraceOpen] = useState(false); // trace a room wall by wall
  const [moveMode, setMoveMode] = useState(false); // the Move pad floats over the sketch
  const [gapErr, setGapErr] = useState('');
  const [addOpen, setAddOpen] = useState(false); // phone: the sheet of things to add
  const [moreOpen, setMoreOpen] = useState(false); // phone: the sheet of the other tools
  const objTypeRef = useRef('door');
  objTypeRef.current = objType;
  const [popup, setPopup] = useState(null); // { x, y }: where the editor for the selected item floats
  const [full, setFull] = useState(false);
  const [textDraft, setTextDraft] = useState(null); // { x, y, value }
  const [cmDraft, setCmDraft] = useState(null); // a new comment being written: { x, y, value }
  const [replyText, setReplyText] = useState('');
  const people = (staffList || []).map((u) => ({ id: u.id, name: staffName(u), email: u.email, role: u.role })).filter((u) => u.id && u.name);
  const me = staff ? { id: staff.id, name: staffName(staff) } : { id: null, name: 'Someone' };
  const meRef = useRef(me); meRef.current = me;
  const cmDraftRef = useRef(null); cmDraftRef.current = cmDraft;
  const peopleRef = useRef(people); peopleRef.current = people;
  const [exportOpen, setExportOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [, bump] = useState(0);
  const [dimErr, setDimErr] = useState('');
  const selRef = useRef(null);
  selRef.current = sel;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const colorRef = useRef(color);
  colorRef.current = color;
  const areaRef = useRef({});
  areaRef.current = { kind: areaKind, cat: waterCat, mode: areaMode, surfaces, height: wallHeight, auto: growthAuto };
  const surfaceRef = useRef('all');
  surfaceRef.current = surfaceView;
  const moistRef = useRef(moist);
  moistRef.current = moist;
  const modeRef = useRef('draw');
  modeRef.current = mode;
  const baseViewRef = useRef(null); // the view before the entry sheet slid the map up
  const movedViewRef = useRef(null);
  const moveIdRef = useRef(null);
  moveIdRef.current = moveId;
  const moistLabelsRef = useRef(true);
  moistLabelsRef.current = moistLabels;
  const popupRef = useRef(null);
  popupRef.current = popup;
  const fullRef = useRef(false);
  fullRef.current = full;

  // what is affected in each room; worked out when the plan changes, not while dragging
  const totalsFor = (plan) => {
    if (totalsRef.current.plan !== plan) totalsRef.current = { plan, totals: affectedTotals(plan) };
    return totalsRef.current.totals;
  };

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = dragRef.current;
    const committed = planRef.current;
    if (totalsRef.current.plan !== committed) totalsRef.current = { plan: committed, totals: affectedTotals(committed) };
    let shown = d?.plan || committed;
    if (modeRef.current === 'moisture') { // the floorplan as it stood on the day being viewed
      if (dvRef.current.src !== shown || dvRef.current.day !== dayRef.current) dvRef.current = { src: shown, day: dayRef.current, out: dayView(shown, dayRef.current) };
      shown = dvRef.current.out;
    }
    drawPlan(ctx, shown, viewRef.current, {
      W: sizeRef.current.W, H: sizeRef.current.H, big: sizeRef.current.W < 520, selection: selRef.current, counts: countsRef.current, surface: surfaceRef.current, moistLabels: moistLabelsRef.current && !!focusRef.current,
      affected: totalsRef.current.totals.rooms, draft: d?.draft || null, hover: d ? null : hoverRef.current,
      pending: toolRef.current === 'corner' ? lastCornerRef.current : null,
      meId: meRef.current.id, commentDraft: cmDraftRef.current,
      ...(modeRef.current === 'moisture' ? { plain: true, grid: false, comments: false, hiddenAreas: layerRef.current.hidden, moisture: layerRef.current.pins, focusRoom: focusRef.current, equipment: layerRef.current.equip, equipDay: dayRef.current, equipFaint: workRef.current !== 'equipment', moistFaint: workRef.current === 'equipment' } : { moisture: false }),
      ghost: d?.ghost || ((toolRef.current === 'object' || toolRef.current === 'missing') && !d ? ghostRef.current : null),
    });
    // a loupe above the finger while a corner, wall or item is dragged, so the spot is visible
    if (d && d.last && ['vertex', 'edge', 'move-obj'].includes(d.mode) && (coarse() || sizeRef.current.W < 520)) {
      const R = 46; const Z = 2.4; const { W } = sizeRef.current;
      const lx = Math.min(W - R - 6, Math.max(R + 6, d.last.x)); const ly = d.last.y > R * 2 + 70 ? d.last.y - R - 56 : d.last.y + R + 56;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.arc(lx * dpr, ly * dpr, R * dpr, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#fff'; ctx.fillRect((lx - R) * dpr, (ly - R) * dpr, R * 2 * dpr, R * 2 * dpr);
      const sr = R / Z;
      ctx.drawImage(c, (d.last.x - sr) * dpr, (d.last.y - sr) * dpr, sr * 2 * dpr, sr * 2 * dpr, (lx - R) * dpr, (ly - R) * dpr, R * 2 * dpr, R * 2 * dpr);
      ctx.restore();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = '#2d7ff9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(lx, ly, R, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(lx - 10, ly); ctx.lineTo(lx + 10, ly); ctx.moveTo(lx, ly - 10); ctx.lineTo(lx, ly + 10); ctx.stroke();
      ctx.restore();
    }
  }, []);
  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; draw(); });
  }, [draw]);

  useEffect(() => { countsRef.current = photoCounts; schedule(); }, [photoCounts, schedule]);
  useEffect(() => { schedule(); setDimErr(''); }, [sel, schedule]);
  useEffect(() => { schedule(); }, [surfaceView, moistLabels, hidden, showPins, showEquip, work, focusId, dayId, schedule]);
  const moistSelId = sel?.kind === 'moisture' ? sel.id : null;
  const prevKindRef = useRef('reading');
  useEffect(() => {
    setRd({ val: '', note: '' });
    setRdErr('');
    const k = (planRef.current.moisture.find((m) => m.id === moistSelId) || {}).kind || 'reading';
    setNumField(k === 'air' ? 'rh' : 'val');
    if (k === 'air' || prevKindRef.current === 'air') setAir({ rh: '', temp: '' }); // the air outside is not the air in the room: it does not carry over
    prevKindRef.current = k;
  }, [moistSelId]);
  // the phone keyboard slides over the bottom of the page: measure how much, so the entry sheet can sit above it
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const upd = () => {
      const st = wrapRef.current;
      if (!st) return;
      setKb(Math.max(0, Math.round(st.getBoundingClientRect().bottom - (vv.offsetTop + vv.height))));
      setVvBox((o) => (o && o.top === Math.round(vv.offsetTop) && o.height === Math.round(vv.height) ? o : { top: Math.round(vv.offsetTop), height: Math.round(vv.height) }));
    };
    upd();
    vv.addEventListener('resize', upd);
    vv.addEventListener('scroll', upd);
    return () => { vv.removeEventListener('resize', upd); vv.removeEventListener('scroll', upd); };
  }, []);
  useEffect(() => { hoverRef.current = null; lastCornerRef.current = null; setPopup(null); setMenuOpen(false); setObjMenu(false); ghostRef.current = null; schedule(); }, [tool, schedule]);

  // size the canvas to its box, keep it crisp on high-density screens, and fit the drawing once
  const fittedRef = useRef(false);
  const topRef = useRef(0);
  useEffect(() => {
    const wrap = wrapRef.current;
    const c = canvasRef.current;
    if (!wrap || !c) return undefined;
    const resize = () => {
      shrinkStage();
      const W = Math.max(200, wrap.clientWidth);
      const H = Math.max(240, wrap.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      const resized = sizeRef.current.W !== W || sizeRef.current.H !== H;
      sizeRef.current = { W, H };
      const topNow = controlInset().top || 0; // the toolbars above the plan grew or shrank
      const topMoved = topRef.current !== topNow;
      topRef.current = topNow;
      if (!fittedRef.current || ((resized || topMoved) && modeRef.current === 'moisture')) { // the floorplan always fits the screen it is on
        viewRef.current = fitFor(W, H);
        fittedRef.current = true;
      }
      draw();
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    const topStack = wrap.querySelector('.sk-topstack');
    if (ro && topStack) ro.observe(topStack);
    window.addEventListener('resize', resize);
    return () => { ro?.disconnect(); window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); rafRef.current = 0; };
  }, [draw]);

  // ---- changes -----------------------------------------------------------
  const commit = useCallback((rawNext) => {
    const next = ensureRoomNums(rawNext); // new rooms and copies get their number here
    undoRef.current.push(planRef.current);
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
    planRef.current = next;
    setCanUndo(true);
    setCanRedo(false);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }, [onChange, schedule]);

  const findSel = (plan, s) => {
    if (!s) return null;
    const list = s.kind === 'room' ? plan.rooms : s.kind === 'area' ? plan.areas : s.kind === 'source' ? plan.sources : s.kind === 'object' ? plan.objects : s.kind === 'moisture' ? plan.moisture : s.kind === 'equipment' ? plan.equipment : s.kind === 'comment' ? plan.comments : plan.marks;
    return list.find((x) => x.id === s.id) || null;
  };

  function undo() {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(planRef.current);
    lastCornerRef.current = null;
    planRef.current = prev;
    setCanUndo(undoRef.current.length > 0);
    setCanRedo(true);
    if (selRef.current && !findSel(prev, selRef.current)) setSel(null);
    onChange?.(prev);
    bump((n) => n + 1);
    schedule();
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(planRef.current);
    lastCornerRef.current = null;
    planRef.current = next;
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    if (selRef.current && !findSel(next, selRef.current)) setSel(null);
    onChange?.(next);
    bump((n) => n + 1);
    schedule();
  }

  const selected = findSel(planRef.current, sel);

  function patchRoom(id, patch) {
    commit({ ...planRef.current, rooms: planRef.current.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function patchMark(id, patch) {
    commit({ ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function patchArea(id, patch) {
    commit({ ...planRef.current, areas: planRef.current.areas.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function patchSource(id, patch) {
    commit({ ...planRef.current, sources: planRef.current.sources.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  }
  function patchObject(id, patch) {
    commit({ ...planRef.current, objects: planRef.current.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }
  function patchMoisture(id, patch) {
    commit({ ...planRef.current, moisture: planRef.current.moisture.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  }
  function duplicateObject(o) {
    const p = planRef.current;
    if (p.objects.length >= MAX_OBJECTS) return;
    const copy = makeObject(o.t, o.x + 1, o.y + 1, { r: o.r, w: o.w, d: o.d, label: o.label, note: o.note, h: o.h, oh: o.oh, f: o.f, m: o.m });
    commit({ ...p, objects: [...p.objects, copy] });
    setSel({ kind: 'object', id: copy.id });
  }
  // the editor floats near the item that was clicked; closing it first saves a field that is still being typed in
  function openPopup(x, y) { setPopup({ x, y }); }
  function closePopup() {
    const ae = document.activeElement;
    if (ae && popRef.current && popRef.current.contains(ae)) ae.blur();
    setPopup(null);
  }
  function removeSelected() {
    const s = selRef.current;
    if (!s) return;
    const p = planRef.current;
    if (s.kind === 'room' && s.vi != null && s.vi >= 0) { // a corner is selected: remove just that corner
      const r = p.rooms.find((x) => x.id === s.id);
      if (r && r.pts.length > 3) { patchRoom(r.id, { pts: removeVertex(r, s.vi).pts }); setSel({ kind: 'room', id: r.id }); return; }
    }
    if (s.kind === 'room') commit({ ...p, rooms: p.rooms.filter((r) => r.id !== s.id) });
    else if (s.kind === 'area') commit({ ...p, areas: p.areas.filter((a) => a.id !== s.id) });
    else if (s.kind === 'source') commit({ ...p, sources: p.sources.filter((q) => q.id !== s.id) });
    else if (s.kind === 'object') commit({ ...p, objects: p.objects.filter((o) => o.id !== s.id) });
    else if (s.kind === 'moisture') commit({ ...p, moisture: p.moisture.filter((m) => m.id !== s.id) });
    else if (s.kind === 'equipment') commit({ ...p, equipment: p.equipment.filter((u) => u.id !== s.id) });
    else if (s.kind === 'comment') {
      const c = p.comments.find((x) => x.id === s.id);
      if (!c || !canDeleteComment(c, meRef.current.id)) return; // only the author can delete
      commit({ ...p, comments: p.comments.filter((x) => x.id !== s.id) });
      onComment?.({ action: 'deleted', tags: [] });
    }
    else commit({ ...p, marks: p.marks.filter((m) => m.id !== s.id) });
    setSel(null);
    setPopup(null);
  }

  // A room typed in by size (see RoomBySize). Returns true when it was added.
  function addRoomBySize(room) {
    if (planRef.current.rooms.length >= MAX_ROOMS) return false;
    commit({ ...planRef.current, rooms: [...planRef.current.rooms, room] });
    setSel({ kind: 'room', id: room.id });
    setPopup(null);
    fit();
    return true;
  }
  // a room traced wall by wall: corners start at 0,0 and the room goes beside the others
  function addTracedRoom(pts, { type = '', label = '' } = {}) {
    const cur = planRef.current;
    if (cur.rooms.length >= MAX_ROOMS) return false;
    const x0 = Math.min(...pts.map((q) => q[0])); const y0 = Math.min(...pts.map((q) => q[1]));
    const w = Math.max(...pts.map((q) => q[0])) - x0; const h = Math.max(...pts.map((q) => q[1])) - y0;
    const at = placeBox(cur.rooms, { w, h }, { nextTo: sel && sel.kind === 'room' ? cur.rooms.find((r) => r.id === sel.id) || null : null });
    const room = { id: makeId(), num: 0, type, other: '', label: String(label).slice(0, 40), notes: '', pts: pts.map((q) => [Math.round((q[0] - x0 + at.x) * 100) / 100, Math.round((q[1] - y0 + at.y) * 100) / 100]) };
    commit({ ...cur, rooms: [...cur.rooms, room] });
    setSel({ kind: 'room', id: room.id });
    setPopup(null);
    fit();
    return true;
  }
  function moveRoomBy(dx, dy) {
    if (!selected || sel.kind !== 'room') return;
    setDimErr('');
    patchRoom(selected.id, translateRoom(selected, dx * MOVE_STEP, dy * MOVE_STEP)); // each tap moves it 6 inches
  }
  function snapRoom() {
    if (!selected || sel.kind !== 'room') return;
    const mv = snapToNeighbour(planRef.current.rooms, selected.id);
    if (!mv) { setDimErr('No room is within 3 feet to snap to.'); return; }
    setDimErr('');
    patchRoom(selected.id, translateRoom(selected, mv.dx, mv.dy));
  }
  function setSizingClass(cls) {
    commit({ ...planRef.current, sizing: { cls } });
  }
  function setCeilText(text) {
    if (!selected || sel.kind !== 'room') return;
    const t = String(text).trim();
    if (!t) { const { ceil, ...rest } = selected; commit({ ...planRef.current, rooms: planRef.current.rooms.map((r) => (r.id === selected.id ? rest : r)) }); setDimErr(''); return; }
    const ft = parseFeet(t);
    if (!Number.isFinite(ft) || !cleanCeil(ft)) { setDimErr(`Ceiling height is between ${MIN_CEIL} and ${MAX_CEIL} feet.`); return; }
    setDimErr('');
    patchRoom(selected.id, { ceil: cleanCeil(ft) });
  }
  function setFloorType(key) {
    if (!selected || sel.kind !== 'room') return;
    if (!key) { const { floor, ...rest } = selected; commit({ ...planRef.current, rooms: planRef.current.rooms.map((r) => (r.id === selected.id ? rest : r)) }); return; }
    patchRoom(selected.id, { floor: key });
  }

  function duplicateRoom() {
    const r = selected;
    if (!r || sel.kind !== 'room' || planRef.current.rooms.length >= MAX_ROOMS) return;
    const b = roomBox(r);
    const copy = { ...r, id: makeId(), pts: translatePts(r.pts, snap(b.w + 1), 0), num: 0, label: r.label ? `${r.label} 2` : '' };
    commit({ ...planRef.current, rooms: [...planRef.current.rooms, copy] });
    setSel({ kind: 'room', id: copy.id });
  }

  // ---- view --------------------------------------------------------------
  function zoomAt(factor, sx, sy) {
    const v = viewRef.current;
    const scale = clampN(v.scale * factor, 3, 120);
    const w = toWorld(v, sx, sy);
    viewRef.current = { scale, ox: sx - w.x * scale, oy: sy - w.y * scale };
    schedule();
  }
  const zoomCenter = (f) => zoomAt(f, sizeRef.current.W / 2, sizeRef.current.H / 2);
  // How far the floating toolbars reach into the drawing, so Fit uses only the space left over.
  // Fit the plan to the box. On the moisture floorplan a wide plan sits under the zoom buttons' column rather
  // than leaving a gap beside it, as long as it clears the buttons.
  // On the moisture floorplan the plan sits at the top, right under the buttons, rather than centred in what is left
  function fitFor(W, H) {
    const v = fitCore(W, H);
    if (modeRef.current !== 'moisture') return v;
    const fr = focusRef.current ? planRef.current.rooms.find((r) => r.id === focusRef.current) : null;
    const b = fr ? polyBox(fr.pts) : planBounds(planRef.current);
    if (!b) return v;
    const ins = controlInset();
    const row = !ins.right; // buttons stacked above the plan (phones)
    if (!row) return v;
    const want = (ins.top || 0) + 12;
    const top = v.oy + b.minY * v.scale;
    const bottom = v.oy + b.maxY * v.scale;
    return bottom - top + want <= H - 8 ? { ...v, oy: v.oy + (want - top) } : v;
  }
  function fitCore(W, H) {
    const fr = focusRef.current ? planRef.current.rooms.find((r) => r.id === focusRef.current) : null;
    const b = fr ? polyBox(fr.pts) : planBounds(planRef.current);
    const ins = controlInset();
    const base = fitView(b, W, H, 24, ins);
    if (modeRef.current !== 'moisture' || !ins.right) return base;
    const wrap = wrapRef.current;
    const tr = wrap?.querySelector('.sketch-over-tr');
    const clear = tr && wrap ? tr.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top + 8 : 0;
    // full width, but below the button column; keep whichever gives the bigger plan
    const wide = fitView(b, W, H, 16, { top: Math.max(ins.top || 0, clear), right: 0 });
    const free = fitView(b, W, H, 16, { top: ins.top || 0, right: 0 }); // same size, centred in the whole box
    if (b && Math.abs(free.scale - wide.scale) < 0.01) {
      const planTop = free.oy + b.minY * free.scale;
      free.oy += Math.max(0, clear - planTop); // nudged down only as far as needed to clear the buttons
      const planBottom = free.oy + b.maxY * free.scale;
      if (planBottom <= H - 16) return free.scale > base.scale ? free : base;
    }
    return wide.scale > base.scale ? wide : base;
  }
  function controlInset() {
    const stage = wrapRef.current;
    if (!stage) return {};
    const r = stage.getBoundingClientRect();
    const tl = stage.querySelector('.sketch-over-tl')?.getBoundingClientRect();
    const tr = stage.querySelector('.sketch-over-tr')?.getBoundingClientRect();
    // on phones the moisture buttons are a row under the top bar rather than a column down the side: the plan goes below both
    const row = !!tr && tr.width > tr.height * 1.5;
    return {
      top: Math.max(tl ? Math.max(0, tl.bottom - r.top) : 0, row ? Math.max(0, tr.bottom - r.top + 4) : 0),
      right: tr && !row ? Math.max(0, r.right - tr.left) : 0,
    };
  }
  // Phones, Moisture tab: the stage is only as tall as the plan needs, so no blank space is left under the floorplan
  function shrinkStage() {
    const st = wrapRef.current;
    if (!st) return;
    st.style.removeProperty('--sk-fit-h');
    if (variant !== 'moisture' || fullRef.current || typeof window === 'undefined' || window.innerWidth > 700) return;
    const fr = focusRef.current ? planRef.current.rooms.find((r) => r.id === focusRef.current) : null;
    const b = fr ? polyBox(fr.pts) : planBounds(planRef.current);
    if (!b) return;
    const H = st.clientHeight; // as tall as it can be
    const v = fitFor(st.clientWidth, H);
    const tip = st.querySelector('.sk-tip') ? 56 : 0; // room for the hint pill under the plan
    const need = Math.ceil(v.oy + b.maxY * v.scale + 26 + tip);
    if (need < H - 6) st.style.setProperty('--sk-fit-h', `${Math.max(need, 250)}px`);
  }
  function fit() {
    shrinkStage();
    viewRef.current = fitFor(sizeRef.current.W, sizeRef.current.H);
    schedule();
  }

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
    // zoomAt only uses refs, so the first copy is always current
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer gestures --------------------------------------------------
  const local = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // a corner snaps to another room's corner when it is close, otherwise to the grid
  function snapCorner(plan, x, y, tolFt, skip) {
    let best = null;
    let bestD = tolFt;
    for (const r of plan.rooms) {
      r.pts.forEach((p, i) => {
        if (skip && r.id === skip.id && i === skip.i) return;
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d <= bestD) { best = p; bestD = d; }
      });
    }
    return best ? { x: best[0], y: best[1] } : { x: snap(x), y: snap(y) };
  }

  function onDown(e) {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    rootRef.current?.focus({ preventScroll: true }); // so the shortcut keys work
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const hadPopup = !!popupRef.current;
    if (hadPopup) closePopup();
    setMenuOpen(false); setObjMenu(false);

    if (pointers.current.size === 2) { // second finger: pinch and pan, drop whatever was being drawn
      const [a, b] = [...pointers.current.values()];
      dragRef.current = {
        mode: 'pinch', view: { ...viewRef.current },
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      };
      schedule();
      return;
    }
    if (pointers.current.size > 2) return;

    const v = viewRef.current;
    const w = toWorld(v, p.x, p.y);
    const plan = planRef.current;
    const phone = coarse() || sizeRef.current.W < 520;
    const tolFt = (phone ? 22 : 12) / v.scale; // a finger-sized zone on phones, in feet
    const edgeTol = (phone ? 20 : 9) / v.scale;
    const t = toolRef.current;
    const ctrl = e.ctrlKey || e.metaKey;

    if (t === 'pan') { dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy }; return; }

    // a new room: starts on a nearby corner or wall of an existing room when there is one
    if (t === 'room' || (t === 'select' && ctrl)) {
      const a = nearestAnchor(plan, w.x, w.y, tolFt);
      const x = a ? a.x : snap(w.x); const y = a ? a.y : snap(w.y);
      dragRef.current = { mode: 'room', x0: x, y0: y, draft: { type: 'room', x, y, w: 0, h: 0 } };
      schedule();
      return;
    }
    if (t === 'break' || t === 'corner') {
      let hit = null;
      for (let i = plan.rooms.length - 1; i >= 0 && !hit; i -= 1) {
        const ed = nearestEdge(plan.rooms[i], w.x, w.y, edgeTol * 1.3);
        if (ed) hit = { room: plan.rooms[i], ed };
      }
      if (hit && t === 'break') {
        const next = insertBreak(hit.room, hit.ed.i, hit.ed.x, hit.ed.y);
        if (next !== hit.room) {
          commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === hit.room.id ? next : r)) });
          setSel({ kind: 'room', id: hit.room.id, ei: hit.ed.i });
        }
      } else if (hit) {
        // Add corner: the first click adds a corner and waits; a click on the next wall cuts the corner between them
        const last = lastCornerRef.current;
        const res = addCornerCut(hit.room, hit.ed.i, hit.ed.x, hit.ed.y, last && last.roomId === hit.room.id ? [last.x, last.y] : null);
        if (res.point) {
          commit({ ...plan, rooms: plan.rooms.map((r) => (r.id === hit.room.id ? res.room : r)) });
          setSel({ kind: 'room', id: hit.room.id });
          lastCornerRef.current = res.cut ? null : { roomId: hit.room.id, x: res.point[0], y: res.point[1] };
        }
      } else {
        lastCornerRef.current = null; // a click on empty space starts over
      }
      hoverRef.current = null;
      schedule();
      dragRef.current = null;
      return;
    }
    if (t === 'area') {
      const a = areaRef.current;
      if (a.kind === 'source') { // a source of loss is a pin: one tap
        if (plan.sources.length < MAX_SOURCES) {
          const pin = newSource(snap(w.x, 0.25), snap(w.y, 0.25), a.surfaces);
          commit({ ...plan, sources: [...plan.sources, pin] });
          setSel({ kind: 'source', id: pin.id });
        }
        dragRef.current = null;
        return;
      }
      dragRef.current = { mode: 'area', free: e.altKey, pts: [[w.x, w.y]], draft: { type: 'area', kind: a.kind, cat: a.cat, pts: [[w.x, w.y]] } };
      schedule();
      return;
    }
    if (t === 'missing') { // press on a wall, then drag along it for part of the wall, or just click for all of it
      const hit = nearestWall(plan, w.x, w.y, Math.max(0.8, 14 / viewRef.current.scale));
      if (hit && plan.objects.length < MAX_OBJECTS) {
        const s0 = Math.round(hit.s / 0.25) * 0.25;
        dragRef.current = { mode: 'missing', hit, s0, s1: s0, moved: false, ghost: null };
        ghostRef.current = null;
        schedule();
      } else dragRef.current = null;
      return;
    }
    if (t === 'moisture' && workRef.current === 'equipment') { // equipment: a tap places a unit or opens one; a drag does nothing
      if (!layerRef.current.equip) { dragRef.current = null; return; } // the equipment layer is off: taps do nothing
      const fr = focusRef.current ? plan.rooms.find((r) => r.id === focusRef.current) : null;
      let hit = moveEqRef.current ? null : hitEquipment(plan, dayRef.current, w.x, w.y, Math.max(tolFt, 26 / v.scale));
      if (hit && fr && !pointInPoly(fr.pts, hit.x, hit.y)) hit = null; // units in the greyed-out rooms are not reachable
      dragRef.current = { mode: 'moist-tap', equip: true, sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, wx: w.x, wy: w.y, hitId: hit ? hit.u.id : null, hadPopup, moved: false };
      return;
    }
    if (t === 'moisture' && !layerRef.current.pins) { dragRef.current = null; return; } // points layer is off: taps do nothing
    if (t === 'moisture') { // a tap places a point or opens a pin; dragging pans, so a finger can move around without dropping points
      const fr = focusRef.current ? plan.rooms.find((r) => r.id === focusRef.current) : null;
      let hit = moveIdRef.current ? null : hitMoisture(plan, w.x, w.y, Math.max(tolFt, 18 / v.scale), surfaceRef.current);
      if (hit && fr && !pointInPoly(fr.pts, hit.x, hit.y)) hit = null; // pins in the greyed-out rooms are not reachable
      dragRef.current = { mode: 'moist-tap', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy, wx: w.x, wy: w.y, hitId: hit ? hit.id : null, hadPopup, moved: false };
      return;
    }
    if (t === 'object') { // click to place; the tool stays on so several can go in a row
      if (plan.objects.length < MAX_OBJECTS) {
        const type = objTypeRef.current;
        const pos = placeObject(plan, type, w.x, w.y, { free: e.altKey });
        const obj = makeObject(type, pos.x, pos.y, { r: pos.r });
        commit({ ...plan, objects: [...plan.objects, obj] });
        setSel({ kind: 'object', id: obj.id });
      }
      dragRef.current = null;
      return;
    }
    if (t === 'text') { dragRef.current = { mode: 'text', sx: p.x, sy: p.y, wx: w.x, wy: w.y }; return; }
    if (t === 'comment') {
      const hit = hitComment(plan, w.x, w.y, v.scale);
      if (hit) { setCmDraft(null); setReplyText(''); setSel({ kind: 'comment', id: hit.id }); dragRef.current = { mode: 'open-comment', sx: p.x, sy: p.y }; schedule(); return; }
      dragRef.current = { mode: 'comment', sx: p.x, sy: p.y, wx: w.x, wy: w.y };
      return;
    }

    // select tool. The selected shape's own corners and walls come first.
    const s = selRef.current;
    const cur = findSel(plan, s);
    if (cur && s.kind === 'room') {
      const vi = nearestVertex(cur, w.x, w.y, tolFt);
      if (vi >= 0) {
        setSel({ kind: 'room', id: cur.id, vi });
        dragRef.current = { mode: 'vertex', id: cur.id, i: vi, plan, moved: false };
        schedule();
        return;
      }
      const ed = nearestEdge(cur, w.x, w.y, edgeTol);
      if (ed) {
        setSel({ kind: 'room', id: cur.id, ei: ed.i });
        dragRef.current = { mode: 'edge', id: cur.id, i: ed.i, wx: w.x, wy: w.y, orig: cur.pts, plan, moved: false };
        schedule();
        return;
      }
    }
    if (cur && s.kind === 'area') {
      const vi = nearestVertex(cur, w.x, w.y, tolFt);
      if (vi >= 0) { dragRef.current = { mode: 'avertex', id: cur.id, i: vi, plan, moved: false }; return; }
    }
    const cm = hitComment(plan, w.x, w.y, v.scale);
    if (cm) {
      setSel({ kind: 'comment', id: cm.id }); setReplyText('');
      dragRef.current = { mode: 'move-comment', id: cm.id, wx: w.x, wy: w.y, orig: { x: cm.x, y: cm.y }, plan, moved: false };
      schedule();
      return;
    }
    const filter = surfaceRef.current;
    const pin = hitSource(plan, w.x, w.y, tolFt * 0.9, filter);
    const obj = pin ? null : hitObject(plan, w.x, w.y, tolFt, filter);
    const mark = pin || obj ? null : hitMarkAt(plan, w.x, w.y, tolFt * 0.6);
    const picked = pickArea(plan, w.x, w.y, edgeTol * 1.4, filter);
    const room = hitRoom(plan, w.x, w.y);
    // an affected area is picked by its edge, or anywhere on it when no room is under it, so a wet room can still be selected
    const area = picked && (picked.onEdge || !room || (cur && s.kind === 'area' && cur.id === picked.area.id)) ? picked.area : null;
    // a pin, pen stroke or note lying on a room wins over the room under it
    if (pin) {
      setSel({ kind: 'source', id: pin.id });
      dragRef.current = { mode: 'move-pin', id: pin.id, wx: w.x, wy: w.y, orig: { x: pin.x, y: pin.y }, plan, moved: false };
    } else if (obj) {
      setSel({ kind: 'object', id: obj.id });
      dragRef.current = { mode: 'move-obj', id: obj.id, wx: w.x, wy: w.y, orig: { x: obj.x, y: obj.y, r: obj.r }, plan, moved: false };
    } else if (mark) {
      setSel({ kind: 'mark', id: mark.id });
      dragRef.current = { mode: 'move-mark', id: mark.id, wx: w.x, wy: w.y, orig: mark, plan, moved: false };
    } else if (area) {
      setSel({ kind: 'area', id: area.id });
      dragRef.current = { mode: 'move-area', id: area.id, wx: w.x, wy: w.y, orig: area.pts, plan, moved: false };
    } else if (room) {
      setSel({ kind: 'room', id: room.id });
      dragRef.current = { mode: 'move-room', id: room.id, wx: w.x, wy: w.y, orig: room.pts, plan, moved: false };
    } else {
      setSel(null);
      dragRef.current = { mode: 'pan', sx: p.x, sy: p.y, ox: v.ox, oy: v.oy };
    }
    schedule();
  }

  function onMove(e) {
    const v = viewRef.current;
    if (!pointers.current.has(e.pointerId)) {
      // no button down: show where a break or corner would go
      const t = toolRef.current;
      if (t === 'missing') { // preview the wall a click would mark as missing
        const p = local(e);
        const w = toWorld(v, p.x, p.y);
        const hit = nearestWall(planRef.current, w.x, w.y, Math.max(0.8, 14 / v.scale));
        if (hit) { const sp = wallSpan(hit, 0, hit.len); ghostRef.current = makeObject('missing', sp.x, sp.y, { r: sp.r, w: sp.w }); } else ghostRef.current = null;
        schedule();
        return;
      }
      if (t === 'object') {
        const p = local(e);
        const w = toWorld(v, p.x, p.y);
        const type = objTypeRef.current;
        const pos = placeObject(planRef.current, type, w.x, w.y, { free: e.altKey });
        ghostRef.current = makeObject(type, pos.x, pos.y, { r: pos.r });
        schedule();
        return;
      }
      if (t === 'break' || t === 'corner') {
        const p = local(e);
        const w = toWorld(v, p.x, p.y);
        const plan = planRef.current;
        let h = null;
        for (let i = plan.rooms.length - 1; i >= 0 && !h; i -= 1) {
          const room = plan.rooms[i];
          const ed = nearestEdge(room, w.x, w.y, (9 / v.scale) * 1.3);
          if (ed) {
            const q = snapOnEdge(room.pts, ed.i, ed.x, ed.y);
            // the wall's two ends, so the length on each side of the circle can be shown
            h = { x: q.x, y: q.y, kind: t, a: room.pts[ed.i], b: room.pts[(ed.i + 1) % room.pts.length], pts: room.pts };
            const last = lastCornerRef.current;
            if (t === 'corner' && last && last.roomId === room.id && addCornerCut(room, ed.i, ed.x, ed.y, [last.x, last.y]).cut) {
              h.from = { x: last.x, y: last.y }; // the next click would cut the corner between the two
            }
          }
        }
        hoverRef.current = h;
        schedule();
      }
      return;
    }
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const d = dragRef.current;
    if (!d) return;

    if (d.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2; const cy = (a.y + b.y) / 2;
      const scale = clampN(d.view.scale * (dist / d.dist), 3, 120);
      const w0 = toWorld(d.view, d.cx, d.cy);
      viewRef.current = { scale, ox: cx - w0.x * scale, oy: cy - w0.y * scale };
      schedule();
      return;
    }
    if (pointers.current.size > 1) return;

    // a finger near the edge of the screen while dragging a corner, wall or item nudges the view so it can keep going
    d.last = p;
    if ((coarse() || sizeRef.current.W < 520) && ['vertex', 'edge', 'move-room', 'move-obj', 'move-pin', 'move-area'].includes(d.mode)) {
      const { W, H } = sizeRef.current; const m = 28; const stepPx = 7;
      const dx = p.x < m ? stepPx : p.x > W - m ? -stepPx : 0;
      const dy = p.y < m ? stepPx : p.y > H - m ? -stepPx : 0;
      if (dx || dy) viewRef.current = { ...viewRef.current, ox: viewRef.current.ox + dx, oy: viewRef.current.oy + dy };
    }
    const vv = viewRef.current;
    const w = toWorld(vv, p.x, p.y);
    const free = e.altKey;
    const tolFt = 10 / vv.scale;
    if (d.mode === 'pan') {
      viewRef.current = { ...v, ox: d.ox + (p.x - d.sx), oy: d.oy + (p.y - d.sy) };
    } else if (d.mode === 'room') {
      const x1 = snap(w.x); const y1 = snap(w.y);
      d.draft = { type: 'room', x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
    } else if (d.mode === 'pen' || d.mode === 'area') {
      d.pts.push([w.x, w.y]);
      d.draft = d.mode === 'pen' ? { type: 'pen', color: colorRef.current, pts: d.pts } : { type: 'area', kind: areaRef.current.kind, cat: areaRef.current.cat, pts: d.pts };
    } else if (d.mode === 'move-room') {
      d.moved = true;
      // the first corner lands on the grid, so the whole room stays on it
      const [x0, y0] = d.orig[0];
      const dx = snap(x0 + (w.x - d.wx)) - x0;
      const dy = snap(y0 + (w.y - d.wy)) - y0;
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: translatePts(d.orig, dx, dy) } : r)) };
    } else if (d.mode === 'vertex') {
      d.moved = true;
      const room = d.plan.rooms.find((r) => r.id === d.id);
      const q = snapCorner(planRef.current, w.x, w.y, tolFt, { id: d.id, i: d.i }); // a corner always moves freely, so it makes an angle
      const base = planRef.current.rooms.find((r) => r.id === d.id) || room;
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: moveVertex(base.pts, d.i, q.x, q.y, { free: true }) } : r)) };
    } else if (d.mode === 'edge') {
      d.moved = true;
      // a wall always slides its ends along the walls beside it; only corners move freely
      d.plan = { ...d.plan, rooms: d.plan.rooms.map((r) => (r.id === d.id ? { ...r, pts: moveEdgeSnapped(d.orig, d.i, w.x - d.wx, w.y - d.wy, { free: false }) } : r)) };
    } else if (d.mode === 'avertex') {
      d.moved = true;
      const base = planRef.current.areas.find((x) => x.id === d.id);
      const q = snapCorner(planRef.current, w.x, w.y, tolFt, null);
      d.plan = { ...d.plan, areas: d.plan.areas.map((x) => (x.id === d.id ? { ...x, pts: base.pts.map((pt, k) => (k === d.i ? [q.x, q.y] : pt)) } : x)) };
    } else if (d.mode === 'move-area') {
      d.moved = true;
      const [x0, y0] = d.orig[0];
      const dx = snap(x0 + (w.x - d.wx)) - x0;
      const dy = snap(y0 + (w.y - d.wy)) - y0;
      d.plan = { ...d.plan, areas: d.plan.areas.map((x) => (x.id === d.id ? { ...x, pts: translatePts(d.orig, dx, dy) } : x)) };
    } else if (d.mode === 'move-pin') {
      d.moved = true;
      const nx = snap(d.orig.x + (w.x - d.wx), 0.25);
      const ny = snap(d.orig.y + (w.y - d.wy), 0.25);
      d.plan = { ...d.plan, sources: d.plan.sources.map((x) => (x.id === d.id ? { ...x, x: nx, y: ny } : x)) };
    } else if (d.mode === 'moist-tap') {
      if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) > 8) d.moved = true; // a drag does nothing here (no panning); only a clean tap counts
    } else if (d.mode === 'missing') {
      const h = d.hit;
      const s = Math.max(0, Math.min(h.len, Math.round(((w.x - h.a[0]) * h.ux + (w.y - h.a[1]) * h.uy) / 0.25) * 0.25));
      d.s1 = s;
      d.moved = Math.abs(d.s1 - d.s0) >= 0.5;
      const sp = d.moved ? wallSpan(h, d.s0, d.s1) : wallSpan(h, 0, h.len);
      d.ghost = makeObject('missing', sp.x, sp.y, { r: sp.r, w: sp.w });
    } else if (d.mode === 'move-obj') {
      d.moved = true;
      const o = d.plan.objects.find((x) => x.id === d.id);
      if (o) {
        const pos = placeObject(d.plan, o.t, d.orig.x + (w.x - d.wx), d.orig.y + (w.y - d.wy), { w: o.w, d: o.d, r: d.orig.r, free });
        d.plan = { ...d.plan, objects: d.plan.objects.map((x) => (x.id === d.id ? { ...x, x: pos.x, y: pos.y, r: pos.r } : x)) };
      }
    } else if (d.mode === 'move-comment') {
      d.moved = true;
      d.plan = { ...planRef.current, comments: planRef.current.comments.map((c) => (c.id === d.id ? { ...c, x: Math.round((d.orig.x + w.x - d.wx) * 100) / 100, y: Math.round((d.orig.y + w.y - d.wy) * 100) / 100 } : c)) };
    } else if (d.mode === 'move-mark') {
      d.moved = true;
      const dx = w.x - d.wx; const dy = w.y - d.wy;
      const o = d.orig;
      const moved = o.type === 'pen'
        ? { ...o, pts: o.pts.map((q) => [q[0] + dx, q[1] + dy]) }
        : { ...o, x: o.x + dx, y: o.y + dy };
      d.plan = { ...planRef.current, marks: planRef.current.marks.map((m) => (m.id === d.id ? moved : m)) };
    }
    schedule();
  }

  function onUp(e) {
    const had = pointers.current.has(e.pointerId);
    const p = had ? local(e) : null;
    pointers.current.delete(e.pointerId);
    const d = dragRef.current;
    if (!d || !had) return;

    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) dragRef.current = null; // stay still until all fingers are up
      if (pointers.current.size === 1) {
        // the finger left behind should not start a pan or draw
        const [id] = [...pointers.current.keys()];
        pointers.current.delete(id);
      }
      schedule();
      return;
    }
    dragRef.current = null;
    const plan = planRef.current;
    if (d.mode === 'moist-tap') { // a tap, not a drag
      if (d.moved || !p) { schedule(); return; }
      if (d.equip) { equipTap(d, plan); schedule(); return; }
      const mv = moveIdRef.current;
      if (mv) { // the tap says where the pin being moved goes
        commit({ ...plan, moisture: plan.moisture.map((m) => (m.id === mv ? { ...m, x: snap(d.wx, 0.25), y: snap(d.wy, 0.25) } : m)) });
        setMoveId(null);
        setSel({ kind: 'moisture', id: mv });
        openPopup(0, 0);
      } else if (d.hitId) {
        setSel({ kind: 'moisture', id: d.hitId });
        openPopup(0, 0);
      } else if (!focusRef.current) { // the whole floorplan: a tap on a room zooms into it
        const rm = !d.hadPopup ? hitRoom(plan, d.wx, d.wy) : null;
        if (rm) enterRoom(rm);
      } else if (!d.hadPopup && plan.moisture.length < MAX_MOISTURE && pointInPoly(plan.rooms.find((r) => r.id === focusRef.current)?.pts || [], d.wx, d.wy)) { // the tap that only closed the sheet does not also drop a point; points go in this room only
        const m = moistRef.current;
        const pt = makeMoisture(nextNumber(plan.moisture), snap(d.wx, 0.25), snap(d.wy, 0.25), { surface: m.surface, material: m.material, type: m.type });
        const initial = !plan.days.length || dayRef.current === plan.days[0].id;
        const undoLen = undoRef.current.length;
        commit({ ...plan, moisture: [...plan.moisture, pt] });
        freshRef.current = initial ? { id: pt.id, undoLen } : null; // a new point on the initial loss only stays once a reading is saved
        setSel({ kind: 'moisture', id: pt.id });
        openPopup(0, 0);
      }
      schedule();
      return;
    }
    // a plain click on something (no drag) opens its editor next to the click
    if (p && ['move-room', 'vertex', 'edge', 'move-mark', 'avertex', 'move-area', 'move-pin', 'move-obj', 'move-comment'].includes(d.mode) && !d.moved) openPopup(p.x, p.y);

    if (d.mode === 'missing') {
      const h = d.hit;
      const sp = d.moved ? wallSpan(h, d.s0, d.s1) : wallSpan(h, 0, h.len);
      if (sp.w >= 0.5) {
        const obj = makeObject('missing', sp.x, sp.y, { r: sp.r, w: sp.w });
        commit({ ...plan, objects: [...plan.objects, obj] });
        setSel({ kind: 'object', id: obj.id });
      }
      schedule();
      return;
    }
    if (d.mode === 'room') {
      const dr = d.draft;
      if (dr && dr.w >= MIN_ROOM && dr.h >= MIN_ROOM && plan.rooms.length < MAX_ROOMS) {
        const room = { id: makeId(), num: 0, type: '', other: '', label: '', notes: '', pts: rectPts(dr.x, dr.y, Math.min(dr.w, MAX_ROOM), Math.min(dr.h, MAX_ROOM)) };
        // the new room takes its space from any room it was drawn over
        const rect = { x: dr.x, y: dr.y, w: Math.min(dr.w, MAX_ROOM), h: Math.min(dr.h, MAX_ROOM) };
        const carved = carveRooms(plan.rooms, rect);
        commit({ ...plan, rooms: [...carved, room] });
        setSel({ kind: 'room', id: room.id });
        setTool('select');
        const c0 = toScreen(viewRef.current, dr.x + dr.w / 2, dr.y + dr.h / 2);
        openPopup(c0.x, c0.y); // a new room: name it right away
      }
    } else if (d.mode === 'pen') {
      const v = viewRef.current;
      const pts = simplifyStroke(d.pts, 2 / v.scale).map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
      if (plan.marks.length < MAX_MARKS && pts.length) {
        const mark = { id: makeId(), type: 'pen', color: colorRef.current, pts };
        commit({ ...plan, marks: [...plan.marks, mark] });
      }
    } else if (d.mode === 'area') {
      const v = viewRef.current;
      const a = areaRef.current;
      const eps = Math.max(0.3, 9 / v.scale);
      const placed = a.kind === 'growth' && a.auto && !d.free ? placeGrowth(plan, d.pts, { mode: a.mode, eps }) : null;
      const pts = placed ? placed.pts : (a.kind === 'growth' && a.auto && !d.free ? null : cleanWater(d.pts, { mode: a.mode, eps }));
      if (pts && plan.areas.length < MAX_AREAS) {
        const area = newArea(pts, placed
          ? { kind: a.kind, smooth: placed.smooth, surfaces: placed.surfaces, height: a.height }
          : { kind: a.kind, cat: a.cat, smooth: a.mode === 'smooth', surfaces: a.surfaces, height: a.height });
        commit({ ...plan, areas: [...plan.areas, area] });
        setSel({ kind: 'area', id: area.id });
      }
    } else if (d.mode === 'open-comment') {
      if (p) openPopup(p.x, p.y);
    } else if (d.mode === 'comment') {
      if (p && Math.hypot(p.x - d.sx, p.y - d.sy) < 8 && planRef.current.comments.length < MAX_COMMENTS) { setPopup(null); setSel(null); setCmDraft({ x: Math.round(d.wx * 100) / 100, y: Math.round(d.wy * 100) / 100, value: '' }); }
    } else if (d.mode === 'text') {
      if (p && Math.hypot(p.x - d.sx, p.y - d.sy) < 8) setTextDraft({ x: snap(d.wx, 0.25), y: snap(d.wy, 0.25), value: '' });
    } else if (['move-room', 'vertex', 'edge', 'move-mark', 'avertex', 'move-area', 'move-pin', 'move-obj', 'move-comment'].includes(d.mode) && d.moved && d.plan) {
      let next = d.plan;
      if (d.mode === 'vertex' || d.mode === 'edge') {
        // a corner or wall that now lines up with its neighbours leaves a stray point: drop it
        const room = next.rooms.find((r) => r.id === d.id);
        if (room) {
          const near = d.mode === 'vertex' ? [d.i - 1, d.i, d.i + 1] : [d.i - 1, d.i, d.i + 1, d.i + 2];
          const pts = dropStraightPoints(room.pts, near);
          if (pts.length !== room.pts.length) {
            next = { ...next, rooms: next.rooms.map((r) => (r.id === d.id ? { ...r, pts } : r)) };
            setSel({ kind: 'room', id: d.id });
          }
        }
      }
      if (d.mode === 'move-comment') next = { ...next, comments: next.comments.map((c) => (c.id === d.id ? withLog(c, logEntry('moved', meRef.current)) : c)) };
      commit(normalizePlan(next));
    }
    schedule();
  }

  // Double-click (or double-tap) a corner to remove it.
  function onDoubleClick(e) {
    if (toolRef.current !== 'select') return;
    const r = canvasRef.current.getBoundingClientRect();
    const v = viewRef.current;
    const w = toWorld(v, e.clientX - r.left, e.clientY - r.top);
    const tolFt = 12 / v.scale;
    const plan = planRef.current;
    const s = selRef.current;
    const order = [...plan.rooms].sort((a, b) => (b.id === s?.id) - (a.id === s?.id));
    for (const room of order) {
      const vi = nearestVertex(room, w.x, w.y, tolFt);
      if (vi < 0) continue;
      if (room.pts.length > 3) { patchRoom(room.id, { pts: removeVertex(room, vi).pts }); setSel({ kind: 'room', id: room.id }); }
      return;
    }
  }

  function onCancel(e) {
    pointers.current.delete(e.pointerId);
    dragRef.current = null;
    schedule();
  }

  function addText(e) {
    e?.preventDefault();
    const t = textDraft;
    if (!t || !t.value.trim() || planRef.current.marks.length >= MAX_MARKS) { setTextDraft(null); return; }
    const mark = { id: makeId(), type: 'text', color, x: t.x, y: t.y, text: t.value.trim().slice(0, 60) };
    commit({ ...planRef.current, marks: [...planRef.current.marks, mark] });
    setTextDraft(null);
  }

  // ---- comments ----------------------------------------------------------
  function stamp(extra) { return { by: { ...meRef.current }, at: new Date().toISOString(), ...extra }; }
  function postComment(e) {
    e?.preventDefault();
    const d = cmDraft;
    const text = d ? d.value.trim() : '';
    if (!text) return;
    const tags = tagsFromText(text, peopleRef.current);
    const c = { id: makeId(), x: d.x, y: d.y, text, tags, done: false, replies: [], ...stamp() };
    c.log = [logEntry('created', meRef.current, c.at)];
    commit({ ...planRef.current, comments: [...planRef.current.comments, c] });
    setCmDraft(null);
    setReplyText('');
    setSel({ kind: 'comment', id: c.id });
    const at = toScreen(viewRef.current, c.x, c.y);
    setPopup({ x: at.x, y: at.y - 15 });
    onComment?.({ action: 'comment', tags: tags.map((t) => t.name) });
  }
  function postReply(c) {
    const text = replyText.trim();
    if (!text || c.replies.length >= MAX_REPLIES) return;
    const tags = tagsFromText(text, peopleRef.current);
    const r = { id: makeId(), text, tags, ...stamp() };
    commit({ ...planRef.current, comments: planRef.current.comments.map((x) => (x.id === c.id ? withLog({ ...x, replies: [...x.replies, r] }, logEntry('replied', meRef.current)) : x)) });
    setReplyText('');
    onComment?.({ action: 'reply', tags: tags.map((t) => t.name) });
  }
  function toggleDone(c) {
    const a = c.done ? 'reopened' : 'resolved';
    commit({ ...planRef.current, comments: planRef.current.comments.map((x) => (x.id === c.id ? withLog({ ...x, done: !c.done }, logEntry(a, meRef.current)) : x)) });
    onComment?.({ action: a, tags: [] });
  }
  function patchComment(id, patch) {
    commit({ ...planRef.current, comments: planRef.current.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }
  function renderText(text) {
    return segments(text, peopleRef.current).map((sg, i) => (sg.tag ? <span key={i} className="cm-tag">{sg.s}</span> : <span key={i}>{sg.s}</span>));
  }

  // ---- full screen -------------------------------------------------------
  // The page is covered by the sketch (works everywhere); where the browser allows it, the whole screen is used too.
  function enterFull() {
    setFull(true);
    try { rootRef.current?.requestFullscreen?.()?.catch?.(() => {}); } catch { /* the covering layout is enough */ }
  }
  function exitFull() {
    setFull(false);
    try { if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {}); } catch { /* already out */ }
  }
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement && fullRef.current && usedNativeRef.current) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const usedNativeRef = useRef(false);
  useEffect(() => {
    usedNativeRef.current = full && !!document.fullscreenElement;
    if (!full) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => { usedNativeRef.current = !!document.fullscreenElement; fit(); }, 120); // refit to the bigger board
    return () => { document.body.style.overflow = prev; clearTimeout(t); };
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!full) { const t = setTimeout(() => fit(), 120); return () => clearTimeout(t); } return undefined; }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- keyboard shortcuts ------------------------------------------------
  // V select, Space (hold) pan, R room, B wall break, C corner, W water, P pen, T text.
  // Delete removes the selection (or the selected corner), Ctrl+Z / Ctrl+Y undo and redo, Esc cancels.
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (inField(e.target) || e.target?.closest?.('.sk-sheet')) return; // the point sheet handles its own keys
    const root = rootRef.current;
    const inside = root && root.contains(e.target);
    // from outside the sketch only when nothing else (a photo viewer, a dialog) is on top
    if (!inside && (e.target !== document.body || document.querySelector('.pv-overlay, .popup-overlay, .camera-overlay, .markup-overlay'))) return;
    if (e.code === 'Space' || e.key === ' ') { // hold Space to pan from any tool
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); // no page scroll, and no click on a focused tool button
      if (!e.repeat && !spaceRef.current && !dragRef.current && !textDraft) { spaceRef.current = { back: toolRef.current }; setTool('pan'); }
      return;
    }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current && selRef.current.kind !== 'equipment') { e.preventDefault(); removeSelected(); return; } // equipment is deleted from its sheet, with a question first
    if (e.key === 'Escape') {
      if (popupRef.current) { closePopup(); return; }
      if (modeRef.current === 'moisture') { if (moveIdRef.current) setMoveId(null); else if (moveEqRef.current) setMoveEqId(null); else if (focusRef.current) exitRoom(); return; } // Esc never leaves the mode by accident
      if (toolRef.current === 'corner' && lastCornerRef.current) { lastCornerRef.current = null; schedule(); return; } // drop the first click, stay in the tool
      if (dragRef.current) { dragRef.current = null; pointers.current.clear(); }
      if (textDraft) { setTextDraft(null); return; }
      if (cmDraft) { setCmDraft(null); return; }
      if (toolRef.current !== 'select') { setTool('select'); hoverRef.current = null; schedule(); return; }
      if (fullRef.current) exitFull();
      return;
    }
    if (modeRef.current === 'draw' && KEYS[k] && !(KEYS[k] === 'area' && !hasAreasRef.current)) { e.preventDefault(); setTool(KEYS[k]); setTextDraft(null); if (k === 'w') setAreaKind(areaKindsRef.current[0] || 'water'); }
  };
  useEffect(() => {
    const h = (e) => keyRef.current?.(e);
    const release = () => { const s = spaceRef.current; if (s) { spaceRef.current = null; setTool(s.back); } };
    const up = (e) => { if (e.code === 'Space' || e.key === ' ') { if (spaceRef.current) e.preventDefault(); release(); } };
    window.addEventListener('keydown', h);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', h); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
  }, []);

  // ---- dimension entry ---------------------------------------------------
  function setDim(which, text) {
    if (!selected || sel.kind !== 'room' || !isRect(selected)) return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < MIN_ROOM || ft > MAX_ROOM) { setDimErr(`Enter a size between ${MIN_ROOM} and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    const b = roomBox(selected);
    patchRoom(selected.id, resizeRect(selected, which === 'w' ? ft : b.w, which === 'h' ? ft : b.h));
  }
  function setWallLength(text) {
    if (!selected || sel.kind !== 'room' || sel.ei == null) return;
    const ft = parseFeet(text);
    if (!Number.isFinite(ft) || ft < 0.5 || ft > MAX_ROOM) { setDimErr(`Enter a length between 0.5 and ${MAX_ROOM} feet, like 12 or 12'6".`); return; }
    setDimErr('');
    patchRoom(selected.id, { pts: setEdgeLength(selected.pts, sel.ei, ft) });
  }

  // ---- moisture readings -------------------------------------------------
  const isStaffOffice = !!staff && staff.role !== 'tech';
  // The point after (step 1) or before (step -1) this one, by pin number, wrapping round. Null when it is the only one.
  function neighbour(id, step) {
    const list = [...planRef.current.moisture].sort((a, b) => a.n - b.n);
    const i = list.findIndex((m) => m.id === id);
    return list.length > 1 && i >= 0 ? list[(i + step + list.length) % list.length] : null;
  }
  function enterRoom(rm) {
    setMoveId(null); setSel(null); setPopup(null);
    focusRef.current = rm.id;
    setFocusId(rm.id);
    fit();
    setTimeout(fit, 80); // again once the Back button has made the top bar taller
  }
  function exitRoom() {
    setMoveId(null); setSel(null); setPopup(null);
    focusRef.current = null;
    setFocusId(null);
    fit();
    setTimeout(fit, 80);
  }
  // the next point (after this one, wrapping round) with no reading yet on the day being logged
  function nextToRead(id, dId) {
    const list = [...planRef.current.moisture].sort((a, b) => a.n - b.n);
    const i = list.findIndex((m) => m.id === id);
    for (let k = 1; k < list.length; k += 1) {
      const c = list[(i + k) % list.length];
      if (c.kind === 'standard') continue; // a dry standard is read once, not every day
      if (!c.readings.some((r) => r.day === dId)) return c;
    }
    return null;
  }
  function startDay(date) {
    const r = addDay(planRef.current, date);
    if (r.added) commit(r.plan);
    setDayId(r.id);
    setDayOpen(false);
  }
  // Recheck mode: one clear start and one clear finish, so a tech always knows whether they are still logging a round of readings.
  function recheckCounts(dId) {
    const pts = planRef.current.moisture.filter((m) => m.kind !== 'standard');
    return { total: pts.length, read: pts.filter((m) => m.readings.some((r) => r.day === dId)).length };
  }
  function startRecheck() {
    const r = addDay(planRef.current, todayKey());
    if (r.added) commit(r.plan);
    setDayId(r.id);
    setRecheck(r.id);
    setRecheckDone(null);
    setDayOpen(false); setLayersOpen(false);
    setSel(null);
  }
  function finishRecheck() {
    const dId = recheck;
    if (!dId) return;
    const c = recheckCounts(dId);
    const left = c.total - c.read;
    if (left > 0 && !window.confirm(`${left} point${left === 1 ? ' has' : 's have'} not been read yet. Finish the recheck anyway?`)) return;
    const d = planRef.current.days.find((x) => x.id === dId);
    setRecheck(null);
    setSel(null);
    setRecheckDone({ name: d ? dayName(planRef.current.days, d.id) : 'Recheck', ...c });
  }
  useEffect(() => { if (recheck && dayId !== recheck) setRecheck(null); }, [dayId, recheck]);
  // A scanned equipment label: open the job on that unit
  useEffect(() => {
    if (!command || command.type !== 'unit' || mode !== 'moisture') return;
    setWork('equipment'); workRef.current = 'equipment';
    gotoUnit(command.unitId);
    onCommandDone?.();
  }, [command]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Start recheck" from the job page's action button: same rules as the button on the floorplan
  useEffect(() => {
    if (!command || command.type !== 'recheck' || mode !== 'moisture') return;
    const p = planRef.current;
    const ds = p.days || [];
    const real = p.moisture.filter((m) => m.kind !== 'standard').length;
    const today = ds.find((d) => d.date === todayKey());
    if (!ds.length || !real) setRcNote('No readings yet. Place the first points, then recheck on a later day.');
    else if (today && ds[0] && today.id === ds[0].id) setRcNote('The loss started today, so log the first readings. A recheck starts from the next day.');
    else startRecheck();
    onCommandDone?.();
  }, [command]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!rcNote) return undefined;
    const t = setTimeout(() => setRcNote(''), 6000);
    return () => clearTimeout(t);
  }, [rcNote]);
  useEffect(() => {
    if (!recheckDone) return undefined;
    const t = setTimeout(() => setRecheckDone(null), 8000);
    return () => clearTimeout(t);
  }, [recheckDone]);
  function deleteDay(id) {
    const nRead = countOnDay(planRef.current, id);
    const nEq = equipmentActionsOnDay(planRef.current, id);
    if ((nRead || nEq) && !window.confirm(`This day has ${nRead && nEq ? 'readings and equipment records' : nRead ? 'readings' : 'equipment records'}. Delete the day and everything logged on it?`)) return;
    commit(removeDay(planRef.current, id));
    setDayId(null);
  }
  function gotoPoint(id) {
    const pt = planRef.current.moisture.find((m) => m.id === id);
    const rm = pt && focusRef.current ? hitRoom(planRef.current, pt.x, pt.y) : null;
    if (rm && rm.id !== focusRef.current) { focusRef.current = rm.id; setFocusId(rm.id); fit(); } // stepping to a point in another room follows it
    setMoveId(null);
    setSel({ kind: 'moisture', id });
    openPopup(0, 0);
  }
  // the on-screen number pad types into whichever of Reading / RH / Temp is lit
  function padType(key) {
    if (numField === 'val') setRd((r) => ({ ...r, val: padEdit(r.val, key, { max: 5, decimals: 1 }) }));
    else if (numField === 'rh') setAir((a) => ({ ...a, rh: padEdit(a.rh, key, { max: 4, decimals: 1 }) }));
    else setAir((a) => ({ ...a, temp: padEdit(a.temp, key, { max: 5, decimals: 1 }) }));
    setRdErr('');
  }
  function sheetKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopup(); return; }
    if (inField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (/^\d$/.test(k) || k === '.') { e.preventDefault(); e.stopPropagation(); padType(k); }
    else if (k === 'Backspace') { e.preventDefault(); e.stopPropagation(); padType('back'); }
    else if (k === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); addReading(null, false); }
  }
  function addReading(e, andNext = false) {
    e?.preventDefault();
    const m = selRef.current?.kind === 'moisture' ? findSel(planRef.current, selRef.current) : null;
    if (!m) return;
    const kind = m.kind || 'reading';
    const rhT = air.rh.trim();
    const tempT = air.temp.trim();
    const rhV = rhT === '' ? null : parseReading(rhT);
    if (rhV !== null && (!Number.isFinite(rhV) || rhV > 100)) { setRdErr('Humidity is a number from 0 to 100.'); return; }
    const tempV = tempT === '' ? null : Number(tempT);
    if (tempV !== null && (!Number.isFinite(tempV) || tempV < -20 || tempV > 200)) { setRdErr('Temperature is a number in degrees F.'); return; }
    let val = null; // an air point has no moisture value, only humidity and temperature
    if (kind === 'air') {
      if (rhV === null && tempV === null) { setRdErr('Enter the humidity or the temperature.'); return; }
    } else {
      val = parseReading(rd.val);
      if (!Number.isFinite(val) || val > 100) { setRdErr('Enter the reading as a number from 0 to 100.'); return; }
    }
    if (m.readings.length >= MAX_READINGS) { setRdErr(`A point holds up to ${MAX_READINGS} readings.`); return; }
    let pl = planRef.current;
    let dId = dayRef.current;
    if (!dId) { const r = addDay(pl); pl = r.plan; dId = r.id; setDayId(r.id); } // the first reading starts the initial loss, today
    const nxt = andNext ? nextToRead(m.id, dId) : null;
    const rday = pl.days.find((d) => d.id === dId);
    commit({ ...pl, moisture: pl.moisture.map((x) => (x.id === m.id ? { ...x, readings: [...x.readings, makeReading({ val, rh: rhV, temp: tempV, note: rd.note, by: meRef.current, day: dId, at: atForDay(rday) })] } : x)) });
    setRd({ val: '', note: '' });
    setRdErr('');
    setNumField(kind === 'air' ? 'rh' : 'val');
    if (nxt) gotoPoint(nxt.id); // rechecking: straight on to the next spot
    else closePopup(); // ready for the next spot
  }
  function setStandard(key, valText, type) {
    const t = valText.trim();
    const std = { ...planRef.current.standards };
    if (t === '') delete std[key];
    else {
      const v = parseReading(t);
      if (!Number.isFinite(v) || v > 100) return false;
      std[key] = { val: v, type };
    }
    commit({ ...planRef.current, standards: std });
    return true;
  }

  // ---- equipment ---------------------------------------------------------
  // what an equipment action is stamped with: the day on screen, when, and who
  function eqStamp(pl) {
    const day = pl.days.find((d) => d.id === dayRef.current) || null;
    return { day: day ? day.id : null, at: atForDay(day), by: meRef.current };
  }
  function patchEquip(id, patch) {
    commit({ ...planRef.current, equipment: planRef.current.equipment.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  }
  function switchWork(w) {
    if (w === workRef.current) return;
    if (w === 'equipment' && equipGate?.blocked) { onEquipBlocked?.(equipGate); return; } // Day 1 steps first
    setWork(w);
    setSel(null); setPopup(null); setMoveId(null); setMoveEqId(null);
    setDayOpen(false); setLayersOpen(false); setEqListOpen(false);
    schedule();
  }
  function placeEquipment(pl0, x, y, rm) {
    let pl = pl0;
    let dId = dayRef.current;
    if (!dId) { const r = addDay(pl); pl = r.plan; dId = r.id; dayRef.current = r.id; setDayId(r.id); } // the first thing logged starts the initial loss, today
    const t = eqTypeRef.current;
    const room = Math.max(0, MAX_EQUIPMENT - pl.equipment.length);
    const qty = Math.min(eqQtyRef.current, room);
    const spots = placementSpots(snap(x, 0.25), snap(y, 0.25), qty, { inside: (px, py) => !rm || pointInPoly(rm.pts, px, py) });
    const made = [];
    for (const [sx, sy] of spots) made.push(makeEquipment(t, nextEquipNumber([...pl.equipment, ...made], t), sx, sy, eqStamp(pl)));
    if (!made.length) return;
    commit({ ...pl, equipment: [...pl.equipment, ...made] });
    setSel({ kind: 'equipment', id: made[made.length - 1].id });
    if (made.length === 1) openPopup(0, 0); // one unit: its sheet opens straight away (asset tag scan, model, note), no second tap needed
    setEqNote(made.length === 1 ? `${unitCode(made[0])} placed in ${roomTitle(rm)}` : `${made.length} ${EQUIPMENT_TYPES[t].plural} placed in ${roomTitle(rm)} (${unitCode(made[0])} to ${unitCode(made[made.length - 1])}). Drag any one to move it.`);
    if (eqQtyRef.current > 1) { eqQtyRef.current = 1; setEqQty(1); } // a bigger number is for one placement, so a second tap does not drop five more by accident
  }
  // a clean tap on the floorplan in equipment mode
  function equipTap(d, pl) {
    const mv = moveEqRef.current;
    if (mv) { // the tap says where the unit being moved goes
      const u = pl.equipment.find((x) => x.id === mv);
      if (u && unitAt(pl, u, dayRef.current).state === 'on') {
        const x = snap(d.wx, 0.25);
        const y = snap(d.wy, 0.25);
        commit({ ...pl, equipment: pl.equipment.map((q) => (q.id === mv ? moveUnit(pl, q, { x, y, ...eqStamp(pl) }) : q)) });
        const rm = hitRoom(pl, x, y);
        if (rm && focusRef.current && rm.id !== focusRef.current) { focusRef.current = rm.id; setFocusId(rm.id); fit(); } // moved into another room: follow it
      }
      setMoveEqId(null);
      setSel({ kind: 'equipment', id: mv });
      openPopup(0, 0);
    } else if (d.hitId) {
      setSel({ kind: 'equipment', id: d.hitId });
      openPopup(0, 0);
    } else if (!focusRef.current) { // the whole floorplan: a tap on a room zooms into it
      const rm = !d.hadPopup ? hitRoom(pl, d.wx, d.wy) : null;
      if (rm) enterRoom(rm);
    } else {
      const rm = pl.rooms.find((r) => r.id === focusRef.current);
      if (!d.hadPopup && rm && pl.equipment.length < MAX_EQUIPMENT && pointInPoly(rm.pts, d.wx, d.wy)) placeEquipment(pl, d.wx, d.wy, rm); // the tap that only closed the sheet does not also place a unit
    }
  }
  function equipChangeState(kind) { // 'pickup' | 'putback' for the unit in the sheet, on the day on screen
    const s = selRef.current;
    const pl = planRef.current;
    const u = s && s.kind === 'equipment' ? pl.equipment.find((x) => x.id === s.id) : null;
    if (!u) return;
    const st = eqStamp(pl);
    const next = kind === 'pickup' ? pickUpUnit(pl, u, st) : putBackUnit(pl, u, st);
    if (next !== u) commit({ ...pl, equipment: pl.equipment.map((x) => (x.id === u.id ? next : x)) });
    closePopup();
    setSel(null);
  }
  function pickUpRoomUnits(s) { // the units of a dry room, picked up on the day on screen
    const pl = planRef.current;
    const d = pl.days.find((x) => x.id === dayRef.current);
    if (!window.confirm(`Pick up ${s.units.length} unit${s.units.length === 1 ? '' : 's'} in ${s.roomName}${d ? ` on ${dayName(pl.days, d.id)} (${dateText(d.date)})` : ''}? Each stays in the log with this pick-up date.`)) return;
    const st = eqStamp(pl);
    const ids = new Set(s.units.map((u) => u.id));
    commit({ ...pl, equipment: pl.equipment.map((u) => (ids.has(u.id) ? pickUpUnit(pl, u, st) : u)) });
  }
  function pickUpAll() {
    const pl = planRef.current;
    const on = equipmentOnSite(pl, dayRef.current);
    if (!on.length) return;
    const d = pl.days.find((x) => x.id === dayRef.current);
    if (!window.confirm(`Pick up all ${on.length} unit${on.length === 1 ? '' : 's'} of equipment${d ? ` on ${dayName(pl.days, d.id)} (${dateText(d.date)})` : ''}? Each stays in the log with this pick-up date.`)) return;
    const st = eqStamp(pl);
    const ids = new Set(on.map((r) => r.u.id));
    commit({ ...pl, equipment: pl.equipment.map((u) => (ids.has(u.id) ? pickUpUnit(pl, u, st) : u)) });
    setEqListOpen(false);
  }
  function gotoUnit(id) {
    const pl = planRef.current;
    const u = pl.equipment.find((x) => x.id === id);
    const st = u ? unitAt(pl, u, dayRef.current) : null;
    if (!st || st.state === 'none') return;
    const rm = hitRoom(pl, st.x, st.y);
    if (rm && rm.id !== focusRef.current) { focusRef.current = rm.id; setFocusId(rm.id); fit(); }
    setEqListOpen(false);
    setMoveEqId(null);
    setSel({ kind: 'equipment', id });
    openPopup(0, 0);
  }
  useEffect(() => {
    if (!eqNote) return undefined;
    const t = setTimeout(() => setEqNote(''), 2600);
    return () => clearTimeout(t);
  }, [eqNote]);
  // A scanned label for the unit in hand: link that asset to it (same rules as the picker, plus the type follows the tag)
  function applyScan(text) {
    const id = scanFor;
    setScanFor(null);
    if (!id || !assets) return;
    const pl = planRef.current;
    const u = pl.equipment.find((x) => x.id === id);
    if (!u) return;
    const r = checkScannedAsset(text, assets.list, u);
    if (!r.ok) { setEqNote(r.text); return; }
    const a = r.asset;
    const patch = { asset: a.id };
    if (r.switchType) { patch.t = a.type; patch.n = nextEquipNumber(pl.equipment.filter((x) => x.id !== u.id), a.type); }
    if (!u.label && a.label) patch.label = a.label.slice(0, 40);
    if (!u.ppd && a.ppd) patch.ppd = a.ppd;
    patchEquip(u.id, patch);
    setEqNote(`${a.tag} linked${r.switchType ? ` (now ${EQUIPMENT_TYPES[a.type].label.toLowerCase()})` : ''}`);
  }

  // ---- export ------------------------------------------------------------
  function renderExport() {
    const plan = modeRef.current === 'moisture' ? dayView(planRef.current, dayRef.current) : planRef.current; // the day on screen
    const b = planBounds(plan);
    if (!b) return null;
    const W = 1600;
    const H = Math.round(clampN(1600 * ((b.maxY - b.minY + 4) / Math.max(b.maxX - b.minX + 4, 4)), 500, 2400));
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    const view = fitView(b, W, H, 60);
    drawPlan(ctx, plan, view, modeRef.current === 'moisture'
      ? { W, H, surface: 'all', plain: true, grid: false, comments: false, hiddenAreas: hidden, moisture: showPins, moistLabels: true, equipment: showEquip, equipDay: dayRef.current }
      : { W, H, counts: {}, affected: totalsFor(plan).rooms, surface: 'all', grid: true, comments: false, moisture: false });
    return out;
  }
  // The customer report: built by lib/reportExport.js (the job's Reports tab makes the same PDFs).
  async function exportReport(variant = 'full') {
    const title = exportName.replace(/\s+moisture$/i, '');
    const pdf = await buildMoistureReportPdf(planRef.current, { variant, title, info: reportInfo || {} });
    download(new Blob([pdf], { type: 'application/pdf' }), 'pdf', variant === 'full' ? '-report' : `-report-${variant}`);
  }
  function download(blob, ext, suffix = '') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'sketch'}${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportAs(kind) {
    setExportOpen(false);
    if (kind === 'report') { exportReport(); return; }
    if (kind === 'summary-report' || kind === 'equipment-report' || kind === 'carrier-report') { exportReport(kind.replace('-report', '')); return; }
    if (kind === 'summary') { download(new Blob([moistureSummaryCsv(planRef.current)], { type: 'text/csv;charset=utf-8' }), 'csv', '-moisture-summary'); return; }
    if (kind === 'csv') { download(new Blob([moistureLogCsv(planRef.current)], { type: 'text/csv;charset=utf-8' }), 'csv', '-moisture-log'); return; }
    if (kind === 'labels') {
      const info = reportInfo || {};
      if (!info.jobId || !planRef.current.equipment.length) return;
      download(new Blob([equipmentLabelsPdf(planRef.current.equipment, { origin: window.location.origin, jobId: info.jobId, jobNumber: info.jobNumber || '' })], { type: 'application/pdf' }), 'pdf', '-equipment-labels');
      return;
    }
    if (kind === 'equipment') { download(new Blob([equipmentLogCsv(planRef.current)], { type: 'text/csv;charset=utf-8' }), 'csv', '-equipment-log'); return; }
    const out = renderExport();
    if (!out) return;
    if (kind === 'png') {
      out.toBlob((blob) => { if (blob) download(blob, 'png'); }, 'image/png');
      return;
    }
    out.toBlob(async (blob) => {
      if (!blob) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      download(new Blob([jpegToPdf(bytes, out.width, out.height, exportName)], { type: 'application/pdf' }), 'pdf');
    }, 'image/jpeg', 0.92);
  }
  const plan = planRef.current;
  const days = plan.days || [];
  const dayOne = useDayOne(plan);
  const curDay = days.find((d) => d.id === dayId) || days[days.length - 1] || null;
  dayRef.current = curDay ? curDay.id : null;
  const dayPlan = dayView(plan, dayRef.current);
  const hasContent = !!(plan.rooms.length || plan.marks.length || plan.areas.length || plan.sources.length || plan.objects.length || plan.moisture.length || plan.equipment.length || plan.comments.length);
  const eqCounts = equipmentCounts(plan, dayRef.current);
  const total = totalArea(plan);
  const totals = totalsFor(plan);
  const room = selected && sel.kind === 'room' ? selected : null;
  const mark = selected && sel.kind === 'mark' ? selected : null;
  const obj = selected && sel.kind === 'object' ? selected : null;
  const area = selected && sel.kind === 'area' ? selected : null;
  const pin = selected && sel.kind === 'source' ? selected : null;
  const mp = selected && sel.kind === 'moisture' ? selected : null;
  const eq = selected && sel.kind === 'equipment' ? selected : null;
  const eqSt = eq ? (unitAt(plan, eq, dayRef.current).state !== 'none' ? unitAt(plan, eq, dayRef.current) : unitAt(plan, eq, null)) : null;
  const tgt = mp ? { id: mp.id, x: mp.x, y: mp.y } : eq && eqSt ? { id: eq.id, x: eqSt.x, y: eqSt.y } : null; // the spot the open sheet is about
  const cm = selected && sel.kind === 'comment' ? selected : null;
  const roomPhotos = room ? photoCounts[room.id] || 0 : 0;
  const rect = room ? isRect(room) : false;
  const box = room ? roomBox(room) : null;
  const wallIdx = room && sel.ei != null && sel.ei < room.pts.length ? sel.ei : null;
  const wallLen = wallIdx != null ? edgeLength(room.pts, wallIdx) : 0;
  const roomAffected = room ? totals.rooms[room.id] : null;
  const showPop = !!(popup && selected) && sel.kind !== 'moisture' && sel.kind !== 'equipment';
  const areaStat = showPop && area ? affectedTotals({ ...plan, areas: [area] }).total[area.kind] : null;
  useLayoutEffect(() => {
    const h = popRef.current ? popRef.current.offsetHeight : 0;
    if (h && Math.abs(h - popH) > 1) setPopH(h);
  });
  useEffect(() => { if (!(sel && sel.kind === 'room')) setMoveMode(false); }, [sel]);
  const sheetOpen = mode === 'moisture' && !!tgt && !!popup;
  const kbPad = full ? kb : 0;
  const phoneSheet = sheetOpen && sizeRef.current.W < 520; // on a phone the entry sheet is a layer over the whole screen, not a box inside the plan
  const pageSheet = phoneSheet && !full; // ...and the page scrolls to keep the point above it
  // The sheet opens under the finger that tapped; the browser's follow-up click would land on it. Ignore touches for a moment.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    if (!sheetOpen) return undefined;
    const t = setTimeout(() => setArmed(true), 400);
    return () => clearTimeout(t);
  }, [sheetOpen, tgt?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sheetOpen || !tgt || pageSheet) return;
    const { W, H } = sizeRef.current;
    const top = 64; // clear of the Draw / Moisture switch along the top
    const bottom = Math.max(top + 60, H - popH - kbPad - 16);
    const v = viewRef.current;
    const at = toScreen(v, tgt.x, tgt.y);
    let { ox, oy } = v;
    if (at.y > bottom || at.y < top) oy += (top + bottom) / 2 - at.y;
    if (at.x < 40 || at.x > W - 40) ox += W / 2 - at.x;
    if (ox !== v.ox || oy !== v.oy) {
      if (!baseViewRef.current) baseViewRef.current = v;
      viewRef.current = { ...v, ox, oy };
      movedViewRef.current = viewRef.current;
      schedule();
    }
    // only when the sheet opens, changes height or moves to another point, so it never fights a drag
  }, [sheetOpen, tgt?.id, popH, kbPad, pageSheet]); // eslint-disable-line react-hooks/exhaustive-deps
  // phone: scroll the page so the point being read stays above the sheet, and put the page back when the sheet closes
  const revealRef = useRef(null);
  useEffect(() => {
    if (!pageSheet || !tgt) return undefined;
    const t = setTimeout(() => {
      const sh = popRef.current;
      const cv = canvasRef.current;
      if (!sh || !cv) return;
      let sc = cv.parentElement;
      while (sc && sc !== document.body && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement; // the nearest box that really scrolls
      if (!sc || sc === document.body) sc = document.scrollingElement;
      if (!sc) return;
      const at = toScreen(viewRef.current, tgt.x, tgt.y);
      const py = cv.getBoundingClientRect().top + at.y;
      const limit = sh.getBoundingClientRect().top - 34;
      const floor = (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top) + 20;
      const delta = py > limit ? py - limit : py < floor ? py - floor : 0;
      if (!delta) return;
      const from = sc.scrollTop;
      const to = clampN(from + delta, 0, Math.max(0, sc.scrollHeight - sc.clientHeight));
      if (Math.abs(to - from) < 2) return;
      revealRef.current = { sc, from: revealRef.current && revealRef.current.sc === sc ? revealRef.current.from : from };
      sc.scrollTo({ top: to, behavior: 'smooth' });
    }, 90);
    return () => clearTimeout(t);
  }, [pageSheet, tgt?.id, popH]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pageSheet) return;
    const r = revealRef.current;
    revealRef.current = null;
    if (r) setTimeout(() => r.sc.scrollTo({ top: r.from, behavior: 'smooth' }), 30);
  }, [pageSheet]);
  // a new point on the initial loss that is closed without a reading goes away, as if it was never dropped
  useEffect(() => {
    const f = freshRef.current;
    if (!f || (sheetOpen && mp && mp.id === f.id)) return;
    freshRef.current = null;
    const pl = planRef.current;
    const pt = pl.moisture.find((m) => m.id === f.id);
    if (!pt || pt.readings.length) return;
    const before = undoRef.current[f.undoLen];
    if (before && !before.moisture.some((m) => m.id === f.id)) { // back to exactly how it was, with no trace in undo
      undoRef.current.length = f.undoLen;
      redoRef.current = [];
      planRef.current = before;
      setCanUndo(undoRef.current.length > 0);
      setCanRedo(false);
      onChange?.(before);
      bump((n) => n + 1);
      schedule();
    } else commit({ ...pl, moisture: pl.moisture.filter((m) => m.id !== f.id) });
    if (selRef.current && selRef.current.id === f.id) setSel(null);
  }, [sheetOpen, mp?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the day strip in the sheet keeps the day being logged in view
  const stripRef = useRef(null);
  useEffect(() => {
    const el = stripRef.current;
    const on = el && el.querySelector('.sk-sd.on');
    if (el && on) el.scrollLeft = Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2);
  }, [sheetOpen, mp?.id, dayId, plan.days.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // keys go to the sheet: focus it so a keyboard can type the reading
  useEffect(() => {
    if (!sheetOpen || !armed) return;
    const el = popRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [sheetOpen, armed, tgt?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // when the sheet closes, the map goes back to where it was, unless the tech has panned or zoomed since
  useEffect(() => {
    if (sheetOpen) return;
    if (baseViewRef.current && viewRef.current === movedViewRef.current) { viewRef.current = baseViewRef.current; schedule(); }
    baseViewRef.current = null;
    movedViewRef.current = null;
  }, [sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const { W: stageW, H: stageH } = sizeRef.current;
  const narrow = stageW < 520;
  const hasPts = plan.moisture.length > 0;
  const roomsKey = plan.rooms.map((r) => r.pts.map((q) => `${q.x},${q.y}`).join(' ')).join('|');
  useEffect(() => { if (variant === 'moisture') shrinkStage(); }, [focusId, hasPts, roomsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const popStyle = !showPop ? null : narrow
    ? { left: 8, right: 8, bottom: 8, maxHeight: '75%' }
    : { left: clampN(popup.x + 14, 8, Math.max(8, stageW - 300 - 8)), top: clampN(popup.y + 14, 8, Math.max(8, stageH - popH - 8)), width: 300, maxHeight: stageH - 16 };
  const textPos = textDraft ? toScreen(viewRef.current, textDraft.x, textDraft.y) : null;
  const textStyle = !textDraft ? null : narrow
    ? { left: 8, right: 8, bottom: 8 }
    : { left: clampN(textPos.x, 8, Math.max(8, stageW - 280 - 8)), top: clampN(textPos.y + 10, 8, Math.max(8, stageH - 110)), width: 280 };

  function pickObject(id) {
    setObjType(id);
    objTypeRef.current = id;
    setTool('object');
    setTextDraft(null);
    setObjMenu(false);
    setAddOpen(false);
  }
  function pickKind(kind) {
    setAreaKind(kind);
    setTool('area');
    setTextDraft(null);
    setMenuOpen(false);
    setMoreOpen(false);
  }

  const areaKinds = areaKindsFor(service, KIND_ORDER);
  const hasAreasRef = useRef(areaKinds.length > 0);
  const areaKindsRef = useRef(areaKinds);
  hasAreasRef.current = areaKinds.length > 0;
  areaKindsRef.current = areaKinds;
  const layerList = areaLayers(plan);
  const toggleLayer = (id) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const closeBtn = <button type="button" className="sk-x" aria-label="Close" onClick={closePopup}>{'\u00d7'}</button>;

  const headBtns = (
    <span className="sketch-head-tools">
      <button type="button" className="sk-icon" onClick={() => setExportOpen(true)} disabled={!hasContent} aria-label="Export" title="Export"><UploadIcon /></button>
      <button type="button" className="sk-icon" onClick={full ? exitFull : enterFull} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen (Esc)' : 'Full screen'}><FullIcon on={full} /></button>
    </span>
  );

  return (
    <div className={`sketch${full ? ' sketch-full' : ''}${mode === 'moisture' ? ' mode-moisture' : ''}`} data-variant={variant} ref={rootRef} tabIndex={-1} style={pageSheet ? { paddingBottom: popH } : undefined}>
      {(full || !headSlot) && <div className="sketch-head-inline">{headBtns}</div>}
      {!full && headSlot && createPortal(headBtns, headSlot)}

      <div className={`sketch-stage${mode === 'moisture' && (dayOpen || layersOpen || eqListOpen) ? ' sk-panel-open' : ''}`} ref={wrapRef}>
        <div className={variant === 'moisture' ? 'sk-topstack' : 'sk-topfrag'}>
        <div className="sketch-over sketch-over-tl">
          {mode === 'draw' && !narrow && (<div className="sketch-tools" role="toolbar" aria-label="Sketch tools">
            {TOOLS.filter(([k]) => k !== 'area' || areaKinds.length > 0).map(([k, label, key]) => (k === 'object' ? (
              <div key={k} className="sketch-menu">
                <button type="button" className={tool === 'object' ? 'on' : ''} aria-haspopup="menu" aria-expanded={objMenu} title={`${label} (${key})`} onClick={(e) => {
                  setMenuOpen(false);
                  if (objMenu) { setObjMenu(false); return; }
                  const b = e.currentTarget.getBoundingClientRect();
                  const st = wrapRef.current.getBoundingClientRect();
                  const width = Math.min(1000, st.width - 16);
                  const left = clampN(b.left, st.left + 8, st.right - width - 8);
                  setObjMenuPos({ left, top: b.bottom + 4, width, maxHeight: Math.max(160, st.bottom - b.bottom - 12) });
                  setObjMenu(true);
                }}>
                  {label}<span className="sk-caret" aria-hidden="true" />
                </button>
                {objMenu && (
                  <div className="sketch-menu-list sk-objects" role="menu" style={objMenuPos ? { position: 'fixed', ...objMenuPos } : undefined}>
                    {OBJECT_GROUPS.map((g) => (
                      <div key={g} className="sk-obj-group">
                        <div className="sk-obj-head">{g}</div>
                        <div className="sk-obj-grid">
                          {Object.entries(OBJECT_TYPES).filter(([, t]) => t.group === g && t.menu !== false).map(([id, t]) => (
                            <button key={id} type="button" role="menuitem" className={tool === 'object' && objType === id ? 'on' : ''} onClick={() => pickObject(id)}>{t.label}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : k === 'area' ? (
              <div key={k} className="sketch-menu">
                <button type="button" className={tool === 'area' ? 'on' : ''} aria-haspopup="menu" aria-expanded={menuOpen} title={`${label} (${key})`} onClick={() => { setObjMenu(false); setMenuOpen(!menuOpen); }}>
                  {label}<span className="sk-caret" aria-hidden="true" />
                </button>
                {menuOpen && (
                  <div className="sketch-menu-list" role="menu">
                    {areaKinds.map((kind) => (
                      <button key={kind} type="button" role="menuitem" className={tool === 'area' && areaKind === kind ? 'on' : ''} onClick={() => pickKind(kind)}>
                        <span className="sk-dot" style={{ background: kindDot(kind) }} />{AREA_KINDS[kind]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={k} type="button" className={tool === k ? 'on' : ''} aria-pressed={tool === k} title={`${label} (${key})`} onClick={() => { setTool(k); setTextDraft(null); }}>
                {label}
              </button>
            )))}
            <button type="button" className="sk-bysize" title="Add a room by typing its size" onClick={() => { setMenuOpen(false); setObjMenu(false); setSizeOpen(true); }}>By size</button>
            <button type="button" className="sk-bysize" title="Trace a room wall by wall from laser readings" onClick={() => { setMenuOpen(false); setObjMenu(false); setTraceOpen(true); }}>Trace</button>
            <select className="sketch-view" value={surfaceView} onChange={(e) => { setSurfaceView(e.target.value); if (e.target.value !== 'all') setMoist((m) => ({ ...m, surface: e.target.value })); }} aria-label="Surface to show" title="Which surface to show">
              {SURFACE_VIEWS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>)}
          {mode === 'moisture' && !sheetOpen && (
            <div className="sk-moist-bar">
              {focusId && (
                <div className="sk-bar-row">
                  <button type="button" className="sk-back" onClick={exitRoom}>{'\u2190'} Back to floorplan</button>
                  <span className="sk-room-chip">{roomTitle(plan.rooms.find((r) => r.id === focusId))}</span>
                </div>
              )}
              <div className="sk-bar-row">
                <button type="button" className="sk-day-btn" aria-expanded={dayOpen} onClick={() => { setDayOpen(!dayOpen); setLayersOpen(false); }}>
                  {curDay ? `${dayName(days, curDay.id)} \u00b7 ${dateText(curDay.date)}` : 'Initial loss \u00b7 today'}<span className="sk-caret" aria-hidden="true" />
                </button>
                <button type="button" className={`sk-dayone-btn${dayOne.total > 0 && dayOne.done >= dayOne.total ? ' all' : ''}`} aria-label={`Day 1 checklist, ${dayOne.done} of ${dayOne.total} done`} title="Day 1 checklist" style={{ '--p': `${dayOne.total ? Math.round((dayOne.done / dayOne.total) * 100) : 0}%` }} onClick={() => { setDayOneOpen(true); setDayOpen(false); setLayersOpen(false); }}>
                  <ChecklistIcon /><span>{dayOne.done}/{dayOne.total}</span>
                </button>
              </div>
              <div className="sk-work" role="group" aria-label="What a tap does">
                <button type="button" className={work === 'readings' ? 'on' : ''} aria-pressed={work === 'readings'} onClick={() => switchWork('readings')}>Readings</button>
                <button type="button" className={work === 'equipment' ? 'on' : ''} aria-pressed={work === 'equipment'} onClick={() => switchWork('equipment')}>Equipment{eqCounts.total > 0 && <span className="sk-work-n">{eqCounts.total}</span>}</button>
              </div>
              {work === 'equipment' && (
                <div className="sk-eq-bar">
                  <div className="sk-eq-pick">
                    <label className="sk-eq-select" style={{ '--eq': EQUIPMENT_TYPES[eqType].color }}>
                      <b>{EQUIPMENT_TYPES[eqType].code}</b>
                      <select value={eqType} aria-label="Equipment to place" onChange={(e) => setEqType(e.target.value)}>
                        {EQUIPMENT_GROUPS.map((g) => (
                          <optgroup key={g} label={g}>
                            {EQUIPMENT_ORDER.filter((k) => EQUIPMENT_TYPES[k].group === g).map((k) => <option key={k} value={k}>{EQUIPMENT_TYPES[k].label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <div className="sk-eq-qty" role="group" aria-label="How many to place with one tap">
                      <button type="button" aria-label="One fewer" disabled={eqQty <= 1} onClick={() => setEqQty((q) => Math.max(1, q - 1))}>{'\u2212'}</button>
                      <input inputMode="numeric" aria-label="Quantity to place" value={eqQty} onChange={(e) => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); setEqQty(Number.isFinite(v) ? Math.min(MAX_PLACE_AT_ONCE, Math.max(1, v)) : 1); }} onFocus={(e) => e.target.select()} />
                      <button type="button" aria-label="One more" disabled={eqQty >= MAX_PLACE_AT_ONCE} onClick={() => setEqQty((q) => Math.min(MAX_PLACE_AT_ONCE, q + 1))}>+</button>
                    </div>
                  </div>
                  {eqQty > 1 && <div className="sk-eq-hint">Next tap places {eqQty} {EQUIPMENT_TYPES[eqType].plural}</div>}
                  {days.length > 1 && curDay && curDay.date !== todayKey() && <div className="sk-pastday" role="note">Logging on {dayName(days, curDay.id)} ({dateText(curDay.date)}), not today. Use the Day button to change it.</div>}
                  <button type="button" className="sk-eq-sum" aria-expanded={eqListOpen} onClick={() => { setEqListOpen(!eqListOpen); setDayOpen(false); setLayersOpen(false); }}>
                    <span>{eqCounts.total ? countText(eqCounts) : 'No equipment on site yet'}</span><span className="sk-caret" aria-hidden="true" />
                  </button>
                  {eqListOpen && (
                    <div className="sk-moist-opts sk-layers sk-eq-list" role="group" aria-label="Equipment on site">
                      <PullPrompt plan={plan} onPickUp={pickUpRoomUnits} />
                      <EquipmentSizing plan={plan} onClass={setSizingClass} onChambers={(list) => commit({ ...planRef.current, chambers: list })} />
                      {(() => {
                        const rows = equipmentOnPlan(plan, dayRef.current);
                        if (!rows.length) return <div className="muted" style={{ fontSize: 13 }}>Nothing placed yet. Tap a room to zoom in, then tap where each piece goes.</div>;
                        const groups = [];
                        for (const r of rows) {
                          const rm = hitRoom(plan, r.x, r.y);
                          const key = rm ? rm.id : '_';
                          let g = groups.find((x) => x.key === key);
                          if (!g) { g = { key, rm, rows: [] }; groups.push(g); }
                          g.rows.push(r);
                        }
                        groups.sort((a, b) => (a.rm ? a.rm.num || 0 : 1e9) - (b.rm ? b.rm.num || 0 : 1e9));
                        return (
                          <>
                            {groups.map((g) => (
                              <div key={g.key} className="sk-eq-grp">
                                <div className="sk-opt-label">{g.rm ? roomTitle(g.rm) : 'Outside the rooms'} {'\u00b7'} {g.rows.filter((r) => r.state === 'on').length}</div>
                                {g.rows.map((r) => (
                                  <button key={r.u.id} type="button" className="sk-eq-row" onClick={() => gotoUnit(r.u.id)}>
                                    <span className="sk-eq-tag" style={{ background: EQUIPMENT_TYPES[r.u.t].color }}>{unitCode(r.u)}</span>
                                    <span className="sk-eq-name">{EQUIPMENT_TYPES[r.u.t].label}{r.u.label ? ` \u00b7 ${r.u.label}` : ''}</span>
                                    {r.state === 'out' && <em>picked up</em>}
                                  </button>
                                ))}
                              </div>
                            ))}
                            {eqCounts.total > 0 && <button type="button" className="danger small" onClick={pickUpAll}>Pick up all on site ({eqCounts.total})</button>}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
              {work === 'readings' && (() => {
                const first = days[0];
                const todayDay = days.find((d) => d.date === todayKey());
                const real = plan.moisture.filter((m) => m.kind !== 'standard').length;
                if (!days.length || !real) return null;
                if (recheck) {
                  const c = recheckCounts(recheck);
                  const all = c.read >= c.total;
                  const d = days.find((x) => x.id === recheck);
                  return (
                    <div className={`sk-recheck on${all ? ' all' : ''}`} role="status">
                      <div className="sk-rc-info">
                        <strong>Rechecking {d ? `${dayName(days, d.id)} \u00b7 ${dateText(d.date)}` : ''}</strong>
                        <span>{all ? 'Every point is read. Tap Finish.' : `${c.read} of ${c.total} points read`}</span>
                        <i className="sk-rc-bar"><b style={{ width: `${c.total ? Math.round((c.read / c.total) * 100) : 0}%` }} /></i>
                      </div>
                      <button type="button" className="sk-rc-btn" onClick={finishRecheck}>Finish recheck</button>
                    </div>
                  );
                }
                if (recheckDone) {
                  return (
                    <div className="sk-recheck done" role="status">
                      <div className="sk-rc-info">
                        <strong>{'\u2713'} {recheckDone.name} saved</strong>
                        <span>{recheckDone.read} of {recheckDone.total} points read</span>
                      </div>
                      <button type="button" className="sk-rc-btn quiet" onClick={() => setRecheckDone(null)}>OK</button>
                    </div>
                  );
                }
                if (todayDay && first && todayDay.id === first.id) return null; // the loss started today: just log the first readings
                const c = todayDay ? recheckCounts(todayDay.id) : null;
                return (
                  <div className="sk-recheck">
                    <button type="button" className="sk-rc-btn start" onClick={startRecheck}>
                      {todayDay ? `Continue recheck \u00b7 ${c.read} of ${c.total} read` : 'Start recheck'}
                    </button>
                  </div>
                );
              })()}
              {dayOpen && (
                <div className="sk-moist-opts sk-layers" role="group" aria-label="Days">
                  {days.map((d) => (
                    <button key={d.id} type="button" className={`sk-dayrow${d === curDay ? ' on' : ''}`} onClick={() => { setDayId(d.id); setDayOpen(false); }}>
                      <span><strong>{dayName(days, d.id)}</strong> {dateText(d.date)}</span>
                      <span className="muted">{countOnDay(plan, d.id)} of {plan.moisture.length} read</span>
                    </button>
                  ))}
                  {!days.length && <div className="muted" style={{ fontSize: 13 }}>The first reading you save starts the initial loss day.</div>}
                  <div className="sk-addday">
                    <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Date for the new day" />
                    <button type="button" className="primary small" disabled={!newDate} onClick={() => startDay(newDate)}>Add day</button>
                  </div>
                  {curDay && <button type="button" className="danger small" onClick={() => deleteDay(curDay.id)}>Delete {dayName(days, curDay.id)}</button>}
                </div>
              )}
              {layersOpen && (
                <div className="sk-moist-opts sk-layers" role="group" aria-label="Layers">
                  <label className="sk-layer locked"><input type="checkbox" checked readOnly disabled /><span className="sk-sw" style={{ background: '#fff', borderColor: '#2f4858' }} /><span className="sk-layer-name">Floorplan<small>rooms, doors, windows</small></span></label>
                  {layerList.map((l) => (
                    <label key={l.id} className="sk-layer"><input type="checkbox" checked={!hidden.has(l.id)} onChange={() => toggleLayer(l.id)} /><span className="sk-sw" style={{ background: l.color }} /><span className="sk-layer-name">{l.name}<small>{l.detail}</small></span></label>
                  ))}
                  <label className="sk-layer"><input type="checkbox" checked={showPins} onChange={() => setShowPins(!showPins)} /><span className="sk-sw pin" /><span className="sk-layer-name">Moisture points<small>{plan.moisture.length} point{plan.moisture.length === 1 ? '' : 's'}</small></span></label>
                  <label className="sk-layer"><input type="checkbox" checked={showEquip} onChange={() => setShowEquip(!showEquip)} /><span className="sk-sw tag" /><span className="sk-layer-name">Equipment<small>{eqCounts.total} on site{plan.equipment.length > eqCounts.total ? `, ${plan.equipment.length - eqCounts.total} not on this day` : ''}</small></span></label>
                  {!layerList.length && <div className="muted" style={{ fontSize: 13 }}>Affected areas drawn on the Sketch tab show up here as layers.</div>}
                  <label className="sk-layer"><input type="checkbox" checked={moistLabels} onChange={() => setMoistLabels(!moistLabels)} /><span className="sk-sw" style={{ background: '#868e96' }} /><span className="sk-layer-name">Readings on map<small>show each point's number on the plan</small></span></label>
                  <label className="sk-opt">Show readings on
                    <select value={surfaceView} onChange={(e) => { setSurfaceView(e.target.value); if (e.target.value !== 'all') setMoist((m) => ({ ...m, surface: e.target.value })); }}>
                      {SURFACE_VIEWS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </label>
                  <div className="chips"><button type="button" onClick={() => setHidden(new Set())}>Show all</button><button type="button" onClick={() => setHidden(new Set(layerList.map((l) => l.id)))}>Hide areas</button><button type="button" onClick={() => { setStdOpen(true); setLayersOpen(false); }}>Dry standards</button></div>
                </div>
              )}
            </div>
          )}
          {tool === 'area' && (
            <div className="sketch-strip" aria-label="Affected area options">
              <span className="sk-strip-kind"><span className="sk-dot" style={{ background: kindDot(areaKind) }} /><strong>{AREA_KINDS[areaKind]}</strong></span>
              {areaKind === 'water' && <CatChips value={waterCat} onChange={setWaterCat} />}
              {areaKind === 'growth' && (
                <div className="chips" role="group" aria-label="Where growth goes" title="Auto: a line snaps to the nearest wall, a loop to the nearest ceiling. Hold Alt while drawing to skip the snap.">
                  <button type="button" className={growthAuto ? 'on' : ''} aria-pressed={growthAuto} onClick={() => setGrowthAuto(true)}>Auto</button>
                  <button type="button" className={growthAuto ? '' : 'on'} aria-pressed={!growthAuto} onClick={() => setGrowthAuto(false)}>Manual</button>
                </div>
              )}
              {areaKind !== 'source' && !(areaKind === 'growth' && growthAuto) && <SurfaceChips value={surfaces} onChange={(next) => { setSurfaces(next); setWallHeight((h) => heightFor(next, h)); }} />}
              {areaKind !== 'source' && (areaKind === 'growth' && growthAuto ? true : surfaces.includes('wall')) && (<><span className="muted">up the wall</span><HeightChips value={wallHeight} onChange={setWallHeight} /></>)}
              {areaKind === 'growth' && growthAuto && <span className="muted">Draw a line along a wall or a loop for the ceiling.</span>}
              {areaKind !== 'source' && (
                <div className="chips" role="group" aria-label="Line cleanup">
                  {[['smooth', 'Rounded'], ['straight', 'Straight']].map(([m, label]) => (
                    <button key={m} type="button" className={areaMode === m ? 'on' : ''} aria-pressed={areaMode === m} onClick={() => setAreaMode(m)}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {tool === 'object' && (
            <div className="sketch-strip sk-info" aria-label="Object options">
              <strong>{OBJECT_TYPES[objType].label}</strong>
              <span className="muted">{OBJECT_TYPES[objType].mode === 'wall' || OBJECT_TYPES[objType].mode === 'wallpoint' ? 'click a wall' : 'click to place'} · Alt: free</span>
            </div>
          )}
          {tool === 'text' && (
            <div className="sketch-strip">
              <span className="muted">Color</span>
              <div className="sketch-colors">
                {MARK_COLORS.map((col) => (
                  <button key={col} type="button" className={color === col ? 'on' : ''} style={{ background: col }} aria-label={`Color ${col}`} onClick={() => setColor(col)} />
                ))}
              </div>
            </div>
          )}

        </div>
        <div className="sketch-over sketch-over-tr" role="toolbar" aria-label="Undo and zoom">
          <button type="button" className="sk-icon" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><UndoIcon /></button>
          <button type="button" className="sk-icon" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Y)"><RedoIcon /></button>
          <button type="button" className="sk-icon" onClick={() => zoomCenter(1.3)} aria-label="Zoom in" title="Zoom in"><PlusIcon /></button>
          <button type="button" className="sk-icon" onClick={() => zoomCenter(1 / 1.3)} aria-label="Zoom out" title="Zoom out"><MinusIcon /></button>
          <button type="button" className="sk-icon" onClick={fit} aria-label="Fit to screen" title="Fit to screen"><FitIcon /></button>
          {mode === 'moisture' && (
            <button type="button" className="sk-icon sk-layers-tool" aria-label="Layers" aria-expanded={layersOpen} title={hidden.size ? `Layers (${layerList.length - hidden.size} of ${layerList.length} areas shown)` : 'Layers'} onClick={() => { setLayersOpen(!layersOpen); setDayOpen(false); setEqListOpen(false); }}>
              <LayersIcon />{hidden.size > 0 && <span className="sk-dotmark" aria-hidden="true" />}
            </button>
          )}
        </div>
        </div>

        {mode === 'draw' && narrow && !showPop && !textDraft && (
          <div className="sk-dock" role="toolbar" aria-label="Sketch tools">
            <button type="button" className={tool === 'select' ? 'on' : ''} aria-pressed={tool === 'select'} onClick={() => { setTool('select'); setTextDraft(null); setAddOpen(false); setMoreOpen(false); }}><DockIcon k="select" /><span>Select</span></button>
            <button type="button" onClick={() => { setAddOpen(false); setMoreOpen(false); setSizeOpen(true); }}><DockIcon k="room" /><span>Room</span></button>
            <button type="button" className={`sk-dock-add${tool === 'object' ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={addOpen} onClick={() => { setMoreOpen(false); setAddOpen(!addOpen); }}><DockIcon k="add" /><span>{tool === 'object' ? OBJECT_TYPES[objType].label : 'Add'}</span></button>
            <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo"><DockIcon k="undo" /><span>Undo</span></button>
            <button type="button" className={['pan', 'break', 'corner', 'missing', 'area', 'text', 'comment', 'room'].includes(tool) ? 'on' : ''} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => { setAddOpen(false); setMoreOpen(!moreOpen); }}><DockIcon k="more" /><span>More</span></button>
          </div>
        )}
        {mode === 'draw' && narrow && addOpen && (
          <div className="sk-sheet" role="dialog" aria-label="Add to the sketch">
            <div className="sk-sheet-head"><strong>Add</strong><button type="button" className="sk-x" aria-label="Close" onClick={() => setAddOpen(false)}>{'×'}</button></div>
            {OBJECT_GROUPS.map((g) => (
              <div key={g} className="sk-obj-group">
                <div className="sk-obj-head">{g}</div>
                <div className="sk-tiles">
                  {Object.entries(OBJECT_TYPES).filter(([, t]) => t.group === g && t.menu !== false).map(([id, t]) => (
                    <button key={id} type="button" className={tool === 'object' && objType === id ? 'on' : ''} onClick={() => pickObject(id)}>{t.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {mode === 'draw' && narrow && moreOpen && (
          <div className="sk-sheet" role="dialog" aria-label="More tools">
            <div className="sk-sheet-head"><strong>More tools</strong><button type="button" className="sk-x" aria-label="Close" onClick={() => setMoreOpen(false)}>{'×'}</button></div>
            <div className="sk-tiles">
              <button type="button" onClick={() => { setMoreOpen(false); setTraceOpen(true); }}>Trace a room</button>
              {TOOLS.filter(([k]) => !['select', 'object', 'area'].includes(k)).map(([k, label]) => (
                <button key={k} type="button" className={tool === k ? 'on' : ''} onClick={() => { setTool(k); setTextDraft(null); setMoreOpen(false); }}>{k === 'room' ? 'Draw a room' : label}</button>
              ))}
            </div>
            {areaKinds.length > 0 && (
              <div className="sk-obj-group">
                <div className="sk-obj-head">Affected areas</div>
                <div className="sk-tiles">
                  {areaKinds.map((kind) => (
                    <button key={kind} type="button" className={tool === 'area' && areaKind === kind ? 'on' : ''} onClick={() => pickKind(kind)}><span className="sk-dot" style={{ background: kindDot(kind) }} />{AREA_KINDS[kind]}</button>
                  ))}
                </div>
              </div>
            )}
            <label className="sk-opt">Show surface
              <select className="sketch-view" value={surfaceView} onChange={(e) => { setSurfaceView(e.target.value); if (e.target.value !== 'all') setMoist((m) => ({ ...m, surface: e.target.value })); }} aria-label="Surface to show">
                {SURFACE_VIEWS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          </div>
        )}

        {mode === 'draw' && moveMode && selected && sel.kind === 'room' && !showPop && (
          <div className="sk-movepad" role="group" aria-label="Move the selected room">
            <div className="sk-move-label">Move 6&quot; per tap</div>
            <div className="sk-move-arrows">
              <button type="button" aria-label="Move left" onClick={() => moveRoomBy(-1, 0)}>{'\u2190'}</button>
              <button type="button" aria-label="Move up" onClick={() => moveRoomBy(0, -1)}>{'\u2191'}</button>
              <button type="button" aria-label="Move down" onClick={() => moveRoomBy(0, 1)}>{'\u2193'}</button>
              <button type="button" aria-label="Move right" onClick={() => moveRoomBy(1, 0)}>{'\u2192'}</button>
            </div>
            <div className="sk-move-actions">
              <button type="button" className="secondary" onClick={snapRoom}>Snap to neighbor</button>
              <button type="button" className="primary" onClick={() => { setMoveMode(false); setDimErr(''); }}>Done</button>
            </div>
            {dimErr && <div className="msg err" style={{ margin: 0 }}>{dimErr}</div>}
          </div>
        )}

        <canvas
          ref={canvasRef}
          className={`sketch-canvas tool-${tool}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onDoubleClick={onDoubleClick}
          onPointerLeave={() => { if (hoverRef.current || ghostRef.current) { hoverRef.current = null; ghostRef.current = null; schedule(); } }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Sketch drawing area"
        />
        {mode === 'moisture' && !sheetOpen && !moveId && !moveEqId && (work === 'equipment'
          ? (focusId
            ? !equipmentOnPlan(plan, dayRef.current).some((r) => pointInPoly(plan.rooms.find((x) => x.id === focusId)?.pts || [], r.x, r.y)) && <div className="sk-tip">Tap the room to place equipment</div>
            : !plan.equipment.length && <div className="sk-tip">Tap a room to zoom in and place equipment</div>)
          : (focusId
            ? !plan.moisture.some((m) => pointInPoly(plan.rooms.find((r) => r.id === focusId)?.pts || [], m.x, m.y)) && <div className="sk-tip">Tap the room to log a reading</div>
            : !plan.moisture.length && <div className="sk-tip">Tap a room to zoom in and log readings</div>))}
        {eqNote && <div className="sk-tip" role="status" style={{ bottom: 70 }}>{eqNote}</div>}
        {rcNote && <div className="sk-tip" role="status" style={{ bottom: 70 }}>{rcNote}</div>}
        {moveEqId && (
          <div className="sk-movebar" role="status">
            <span>Tap where {(() => { const u = plan.equipment.find((x) => x.id === moveEqId); return u ? unitCode(u) : 'it'; })()} should go</span>
            <button type="button" onClick={() => { const id = moveEqId; setMoveEqId(null); gotoUnit(id); }}>Cancel</button>
          </div>
        )}
        {moveId && (
          <div className="sk-movebar" role="status">
            <span>Tap where point {plan.moisture.find((m) => m.id === moveId)?.n} should go</span>
            <button type="button" onClick={() => { const id = moveId; setMoveId(null); gotoPoint(id); }}>Cancel</button>
          </div>
        )}

        {textDraft && (
          <form className="sketch-pop" style={textStyle} onSubmit={addText}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="sk-text">Note</label>
              <input id="sk-text" autoFocus maxLength={60} value={textDraft.value} onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })} placeholder="Door, wet wall, sump..." />
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary small">Add</button>
              <button type="button" className="secondary small" onClick={() => setTextDraft(null)}>Cancel</button>
            </div>
          </form>
        )}

        {cmDraft && (() => {
          const pos = toScreen(viewRef.current, cmDraft.x, cmDraft.y);
          const st = narrow ? { left: 8, right: 8, bottom: 8 } : { left: clampN(pos.x - 20, 8, Math.max(8, stageW - 300 - 8)), top: clampN(pos.y + 10, 8, Math.max(8, stageH - 190)), width: 300 };
          return (
            <form className="sketch-pop" style={st} onSubmit={postComment}>
              <div className="sketch-pop-head"><strong>New comment</strong><button type="button" className="sk-x" aria-label="Close" onClick={() => setCmDraft(null)}>{'\u00d7'}</button></div>
              <MentionBox id="sk-cm-new" autoFocus people={people} value={cmDraft.value} onChange={(v) => setCmDraft({ ...cmDraft, value: v })} onSubmit={postComment} placeholder="Write a comment. Type @ to tag a teammate" />
              <div className="row"><button className="primary small" disabled={!cmDraft.value.trim()}>Post</button><button type="button" className="secondary small" onClick={() => setCmDraft(null)}>Cancel</button></div>
            </form>
          );
        })()}

        {showPop && (
          <div className="sketch-pop" ref={popRef} style={popStyle} role="dialog" aria-label="Edit selection">
            {room && narrow && wallIdx != null && (
              <>
                <div className="sketch-pop-head"><strong>Wall {wallIdx + 1}{room.num ? ` \u00b7 Room ${room.num}` : ''}</strong>{closeBtn}</div>
                <div className="field sk-wall-big"><label htmlFor="sk-wall-len-m">Length (feet, like 12 or 12'6&quot;)</label>
                  <input id="sk-wall-len-m" autoFocus key={`${room.id}-wm-${wallIdx}-${wallLen}`} inputMode="decimal" defaultValue={fmtFeet(wallLen)} onFocus={(e) => e.target.select()} onBlur={(e) => setWallLength(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </div>
                {dimErr && <div className="msg err" style={{ margin: 0 }}>{dimErr}</div>}
                <div className="row">
                  <button type="button" className="primary" onClick={closePopup}>Done</button>
                  <button type="button" onClick={() => { setDimErr(''); setSel({ kind: 'room', id: room.id }); }}>Room details</button>
                </div>
              </>
            )}
            {room && !(narrow && wallIdx != null) && (
              <>
                <div className="sketch-pop-head"><strong>{room.num ? `Room ${room.num}` : 'Room'}</strong>{closeBtn}</div>
                <div className="field"><label htmlFor="sk-room-type">Room {room.num || ''} type</label>
                  <select id="sk-room-type" value={room.type || ''} onChange={(e) => patchRoom(room.id, { type: e.target.value, ...(e.target.value === 'other' ? {} : { other: '' }) })}>
                    <option value="">Choose a type...</option>
                    {Object.entries(ROOM_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
                {room.type === 'other' && (
                  <div className="field"><label htmlFor="sk-room-other">What kind of room</label>
                    <input id="sk-room-other" key={`${room.id}-o-${room.other}`} defaultValue={room.other} maxLength={30} onBlur={(e) => e.target.value !== room.other && patchRoom(room.id, { other: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Sunroom" />
                  </div>
                )}
                <div className="field"><label htmlFor="sk-room-name">Name (optional)</label>
                  <input id="sk-room-name" key={`${room.id}-l-${room.label}`} defaultValue={room.label} maxLength={40} onBlur={(e) => e.target.value !== room.label && patchRoom(room.id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Primary bedroom" />
                </div>
                <div className="grid2">
                  {hasFeature(service, 'ceilingHeight') && <div className="field"><label htmlFor="sk-room-ceil">Ceiling height (ft)</label>
                    <input id="sk-room-ceil" key={`${room.id}-c-${room.ceil || ''}`} inputMode="decimal" defaultValue={room.ceil ? fmtFeet(room.ceil) : ''} placeholder="8" onBlur={(e) => setCeilText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>}
                  <div className="field"><label htmlFor="sk-room-floor">Floor</label>
                    <select id="sk-room-floor" value={room.floor || ''} onChange={(e) => setFloorType(e.target.value)}>
                      <option value="">Not set</option>
                      {Object.entries(FLOOR_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </div>
                </div>
                {rect ? (
                  <div className="grid2">
                    <div className="field"><label htmlFor="sk-room-w">Width</label>
                      <input id="sk-room-w" key={`${room.id}-w-${box.w}`} inputMode="decimal" defaultValue={fmtFeet(box.w)} onBlur={(e) => setDim('w', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                    </div>
                    <div className="field"><label htmlFor="sk-room-h">Length</label>
                      <input id="sk-room-h" key={`${room.id}-h-${box.h}`} inputMode="decimal" defaultValue={fmtFeet(box.h)} onBlur={(e) => setDim('h', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                    </div>
                  </div>
                ) : (
                  <div className="muted">{room.pts.length} corners, about {roomSizeText(room)}. Click a wall to set its length.</div>
                )}
                {wallIdx != null && (
                  <div className="field"><label htmlFor="sk-wall-len">Selected wall</label>
                    <input id="sk-wall-len" key={`${room.id}-wl-${wallIdx}-${wallLen}`} inputMode="decimal" defaultValue={fmtFeet(wallLen)} onBlur={(e) => setWallLength(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                )}
                {dimErr && <div className="msg err" style={{ margin: 0 }}>{dimErr}</div>}
                <div className="muted">{roomAreaText(room)}{room.ceil ? ` \u00b7 ${Math.round(roomArea(room) * room.ceil).toLocaleString('en-US')} cu ft` : ''}</div>
                {roomAffected && ['water', 'growth', 'smoke'].filter((kd) => roomAffected[kd]).map((kd) => (
                  <div key={kd} className="sk-aff" style={{ color: kindDot(kd) }}><strong>{AREA_KINDS[kd]}</strong> {surfaceText(roomAffected[kd])} sq ft</div>
                ))}
                <button type="button" className="secondary" onClick={() => { setDimErr(''); setMoveMode(true); closePopup(); }}>Move this room</button>
                <div className="field"><label htmlFor="sk-room-notes">Notes</label>
                  <input id="sk-room-notes" key={`${room.id}-n-${room.notes}`} defaultValue={room.notes} maxLength={300} onBlur={(e) => e.target.value !== room.notes && patchRoom(room.id, { notes: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Hardwood, wet along north wall" />
                </div>
                <div className="row">
                  {onAddRoomPhoto && <button type="button" className="secondary small" onClick={() => onAddRoomPhoto(room)}>Add photo</button>}
                  {onQuoteRoom && <button type="button" className="secondary small" onClick={() => onQuoteRoom(room)}>Add to quote</button>}
                  {onViewRoomPhotos && roomPhotos > 0 && <button type="button" className="secondary small" onClick={() => onViewRoomPhotos(room)}>Photos ({roomPhotos})</button>}
                  {sel.vi != null && sel.vi >= 0 && room.pts.length > 3 && <button type="button" className="secondary small" onClick={removeSelected}>Remove corner</button>}
                  <button type="button" className="danger small" onClick={() => { commit({ ...planRef.current, rooms: planRef.current.rooms.filter((r) => r.id !== room.id) }); setSel(null); setPopup(null); }}>Delete</button>
                </div>
                <details className="sk-more">
                  <summary>More</summary>
                  <div className="row">
                    <button type="button" className="secondary small" onClick={duplicateRoom}>Duplicate</button>
                    {rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, resizeRect(room, box.h, box.w))}>Swap width and length</button>}
                    {!rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, { pts: tidyPts(room.pts) })}>Tidy corners</button>}
                    {!rect && <button type="button" className="secondary small" onClick={() => patchRoom(room.id, { pts: turnRoomPts(room.pts, 1) })}>Turn 90{'\u00b0'}</button>}
                  </div>
                </details>
              </>
            )}

            {area && (
              <>
                <div className="sketch-pop-head"><strong><span className="sk-dot" style={{ background: kindDot(area.kind === 'water' ? 'water' : area.kind) }} />{AREA_KINDS[area.kind]}</strong>{closeBtn}</div>
                <div className="chips" role="group" aria-label="Type">
                  {['water', 'growth', 'smoke'].map((kd) => (
                    <button key={kd} type="button" className={area.kind === kd ? 'on' : ''} aria-pressed={area.kind === kd} onClick={() => patchArea(area.id, { kind: kd, cat: kd === 'water' ? area.cat : 1 })}>{AREA_KINDS[kd]}</button>
                  ))}
                </div>
                {area.kind === 'water' && <CatChips value={area.cat} onChange={(n) => patchArea(area.id, { cat: n })} />}
                <div className="muted sk-label">Surfaces</div>
                <SurfaceChips value={area.surfaces} onChange={(next) => patchArea(area.id, { surfaces: next, height: heightFor(next, area.height) })} />
                {area.surfaces.includes('wall') && (<><div className="muted sk-label">Up the wall</div><HeightChips value={area.height} onChange={(h) => patchArea(area.id, { height: h })} /></>)}
                <div className="muted">{areaStat ? `${surfaceText(areaStat)} sq ft` : 'Not inside any room yet.'} Drag the corners to adjust, or the shape to move it.</div>
                <div className="row">
                  <div className="chips" role="group" aria-label="Line cleanup" style={{ margin: 0 }}>
                    {[['smooth', 'Rounded'], ['straight', 'Straight']].map(([m, label]) => (
                      <button key={m} type="button" className={(area.smooth ? 'smooth' : 'straight') === m ? 'on' : ''} onClick={() => patchArea(area.id, { smooth: m === 'smooth' })}>{label}</button>
                    ))}
                  </div>
                  <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
                </div>
              </>
            )}

            {pin && (
              <>
                <div className="sketch-pop-head"><strong><span className="sk-dot" style={{ background: kindDot('source') }} />Source of loss</strong>{closeBtn}</div>
                <div className="field"><label htmlFor="sk-pin-note">Note</label>
                  <input id="sk-pin-note" key={`${pin.id}-${pin.note}`} defaultValue={pin.note} maxLength={80} onBlur={(e) => e.target.value !== pin.note && patchSource(pin.id, { note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Supply line, roof leak..." />
                </div>
                <div className="row"><button type="button" className="danger small" onClick={removeSelected}>Delete</button></div>
              </>
            )}

            {obj && (() => {
              const ot = OBJECT_TYPES[obj.t];
              const isWall = ot.mode === 'wall';
              const feet = (id, label, value, key, min = 0.1, max = 100) => (
                <div className="field" key={key}><label htmlFor={id}>{label}</label>
                  <input id={id} key={`${obj.id}-${key}-${value}`} inputMode="decimal" defaultValue={fmtFeet(value)}
                    onBlur={(e) => { const ft = parseFeet(e.target.value); if (Number.isFinite(ft) && ft >= min && ft <= max) { if (Math.abs(ft - value) > 1e-6) patchObject(obj.id, { [key]: Math.round(ft * 100) / 100 }); } else e.target.value = fmtFeet(value); }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </div>
              );
              // doors and windows are quoted in inches
              const inches = (id, label, value, key, minIn, maxIn) => (
                <div className="field" key={key}><label htmlFor={id}>{label}</label>
                  <input id={id} key={`${obj.id}-${key}-${value}`} inputMode="decimal" defaultValue={inchesText(value)}
                    onBlur={(e) => { const ft = parseInches(e.target.value); if (Number.isFinite(ft) && ft * 12 >= minIn && ft * 12 <= maxIn) { if (Math.abs(ft - value) > 1e-6) patchObject(obj.id, { [key]: Math.round(ft * 10000) / 10000 }); } else e.target.value = inchesText(value); }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </div>
              );
              const changeDoorType = (to) => {
                const nu = OBJECT_TYPES[to];
                patchObject(obj.id, {
                  t: to,
                  w: Math.abs(obj.w - ot.w) < 1e-6 ? nu.w : obj.w, // a size that was never changed follows the new type
                  oh: Math.abs((obj.oh ?? ot.oh) - ot.oh) < 1e-6 ? nu.oh : obj.oh,
                });
              };
              const doorTypes = Object.entries(OBJECT_TYPES).filter(([, t]) => t.family === 'door');
              return (
                <>
                  <div className="sketch-pop-head"><strong>{ot.family === 'door' ? 'Door' : ot.label}</strong>{closeBtn}</div>
                  {plan.objects.length > 1 && (
                    <div className="row sk-objnav">
                      {[[-1, '\u2039 Previous'], [1, 'Next \u203a']].map(([step, text]) => (
                        <button key={step} type="button" className="secondary" onClick={() => { const i = plan.objects.findIndex((o) => o.id === obj.id); const to = plan.objects[(i + step + plan.objects.length) % plan.objects.length]; setGapErr(''); setSel({ kind: 'object', id: to.id }); }}>{text}</button>
                      ))}
                    </div>
                  )}
                  {ot.family === 'door' && (
                    <div className="field"><label htmlFor="sk-obj-type">Type</label>
                      <select id="sk-obj-type" value={obj.t} onChange={(e) => changeDoorType(e.target.value)}>
                        {doorTypes.map(([id, t]) => <option key={id} value={id}>{t.typeLabel || t.label}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="field"><label htmlFor="sk-obj-label">Label</label>
                    <input id="sk-obj-label" key={`${obj.id}-l-${obj.label}`} defaultValue={obj.label} maxLength={40} placeholder={ot.label} onBlur={(e) => e.target.value !== obj.label && patchObject(obj.id, { label: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                  {isWall && (() => {
                    const pl = openingPlace(plan, obj);
                    if (!pl) return null;
                    return (
                      <div className="field"><label htmlFor="sk-obj-gap">Distance from the left or top corner (feet)</label>
                        <input id="sk-obj-gap" key={`${obj.id}-gap-${pl.gapStart}`} inputMode="decimal" defaultValue={fmtFeet(Math.max(0, pl.gapStart))}
                          onBlur={(e) => { const ft = parseFeet(e.target.value); const at = Number.isFinite(ft) ? placeOpeningAt(plan, obj, ft) : null; if (at) { setGapErr(''); if (Math.abs(ft - pl.gapStart) > 1e-6) patchObject(obj.id, at); } else setGapErr('That does not fit on the wall.'); }}
                          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                        <span className="muted">{fmtFeet(Math.max(0, pl.gapEnd))} to the other corner</span>
                        {gapErr && <div className="msg err" style={{ margin: '4px 0 0' }}>{gapErr}</div>}
                      </div>
                    );
                  })()}
                  {isWall && ot.feet && feet('sk-obj-w', 'Length', obj.w, 'w', 0.5, 100)}
                  {isWall && !ot.feet && (
                    <div className="grid2">
                      {inches('sk-obj-w', 'Width', obj.w, 'w', 6, 400)}
                      {inches('sk-obj-oh', 'Height', obj.oh ?? ot.oh, 'oh', 12, 240)}
                    </div>
                  )}
                  {isWall && !ot.feet && ot.h != null && inches('sk-obj-h', 'Sill height', obj.h ?? ot.h, 'h', 0, 120)}
                  {!isWall && ot.mode !== 'wallpoint' && (
                    <div className="grid2">
                      {feet('sk-obj-w', ot.mode === 'box' ? 'Length' : 'Size', obj.w, 'w')}
                      {ot.mode === 'box' && feet('sk-obj-d', 'Depth', obj.d, 'd')}
                    </div>
                  )}
                  {!isWall && ot.h != null && feet('sk-obj-h', 'Height off floor', obj.h ?? ot.h, 'h', 0, 30)}
                  <div className="field"><label htmlFor="sk-obj-note">Note</label>
                    <input id="sk-obj-note" key={`${obj.id}-n-${obj.note}`} defaultValue={obj.note} maxLength={80} placeholder="Brand, material, size..." onBlur={(e) => e.target.value !== obj.note && patchObject(obj.id, { note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                  <div className="row">
                    {ot.mode === 'box' && <button type="button" className="secondary small" onClick={() => patchObject(obj.id, { r: (obj.r + 90) % 360 })}>Rotate</button>}
                    {((isWall && !ot.feet) || ot.mode === 'wallpoint' || ot.kind === 'stairs') && <button type="button" className="secondary small" onClick={() => patchObject(obj.id, { f: !obj.f })}>{ot.kind === 'stairs' ? 'Flip direction' : isWall ? 'Flip side' : 'Flip'}</button>}
                    {['door', 'dutch', 'pocket', 'barn'].includes(ot.kind) && <button type="button" className="secondary small" onClick={() => patchObject(obj.id, { m: !obj.m })}>{ot.kind === 'door' || ot.kind === 'dutch' ? 'Flip hinge' : 'Flip end'}</button>}
                    <button type="button" className="secondary small" onClick={() => duplicateObject(obj)}>Duplicate</button>
                    <button type="button" className="danger small" onClick={removeSelected}>Delete</button>
                  </div>
                </>
              );
            })()}

            {cm && (
              <>
                <div className="sketch-pop-head"><strong>Comment{cm.done ? ' (resolved)' : ''}</strong>{closeBtn}</div>
                <div className="cm-thread">
                  {[cm, ...cm.replies].map((it, i) => (
                    <div key={it.id} className={i ? 'cm-item' : ''}>
                      <div className="cm-meta"><strong>{it.by.name}</strong> {timeAgo(it.at)}</div>
                      <div className="cm-text">{renderText(it.text)}</div>
                    </div>
                  ))}
                </div>
                <MentionBox id="sk-cm-reply" rows={2} people={people} value={replyText} onChange={setReplyText} onSubmit={() => postReply(cm)} placeholder="Reply. Type @ to tag" />
                <div className="row">
                  <button type="button" className="primary small" disabled={!replyText.trim()} onClick={() => postReply(cm)}>Reply</button>
                  <button type="button" className="secondary small" onClick={() => toggleDone(cm)}>{cm.done ? 'Reopen' : 'Resolve'}</button>
                  {canDeleteComment(cm, me.id) && <button type="button" className="danger small" onClick={removeSelected}>Delete</button>}
                </div>
                <details className="cm-log">
                  <summary>Activity</summary>
                  <ul>{activity(cm).map((l, i) => <li key={i}><span>{l.text}</span> <span className="cm-meta">{l.at ? new Date(l.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span></li>)}</ul>
                </details>
              </>
            )}

            {mark && (
              <>
                <div className="sketch-pop-head"><strong>{mark.type === 'text' ? 'Note' : 'Pen line'}</strong>{closeBtn}</div>
                {mark.type === 'text' && (
                  <div className="field"><label htmlFor="sk-mark-text">Text</label>
                    <input id="sk-mark-text" key={mark.id} defaultValue={mark.text} maxLength={60} onBlur={(e) => e.target.value.trim() && e.target.value !== mark.text && patchMark(mark.id, { text: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </div>
                )}
                <div className="sketch-colors">
                  {MARK_COLORS.map((col) => (
                    <button key={col} type="button" className={mark.color === col ? 'on' : ''} style={{ background: col }} aria-label={`Color ${col}`} onClick={() => patchMark(mark.id, { color: col })} />
                  ))}
                </div>
                <div className="row"><button type="button" className="danger small" onClick={removeSelected}>Delete</button></div>
              </>
            )}
          </div>
        )}

        {sheetOpen && mp && (() => {
          const goal = goalFor(plan, mp);
          const mpv = dayPlan.moisture.find((x) => x.id === mp.id) || mp;
          const st = moistureStatus(mpv, goal);
          const toRead = nextToRead(mp.id, dayRef.current);
          const kind = mp.kind || 'reading';
          const isAir = kind === 'air';
          const color = MOISTURE_COLORS[st.state];
          const short = MOISTURE_TYPES[mp.type].short;
          const roomHere = hitRoom(plan, mp.x, mp.y);
          const ordered = sortedReadings(mp);
          const std = plan.standards[mp.material];
          const prevPt = neighbour(mp.id, -1);
          const nextPt = neighbour(mp.id, 1);
          const airGpp = gpp(air.temp.trim() === '' ? null : air.temp, air.rh.trim() === '' ? null : air.rh);
          const canDel = (r) => isStaffOffice || (!!r.by?.id && r.by.id === me.id);
          const canSave = isAir ? !!(air.rh.trim() || air.temp.trim()) : !!rd.val.trim();
          const creating = !!freshRef.current && freshRef.current.id === mp.id && !mp.readings.length; // just dropped on the initial loss: Save and close instead of arrows and X
          const setOpt = (patch) => { patchMoisture(mp.id, patch); setMoist((m) => ({ ...m, ...patch })); }; // the next point starts out like this one
          const kindLocked = (k) => mp.readings.length > 0 && (k === 'air') !== isAir; // readings with a moisture value can't become air readings, or the other way round
          const setKind = (k) => {
            if (k === kind || kindLocked(k)) return;
            patchMoisture(mp.id, { kind: k });
            setNumField(k === 'air' ? 'rh' : 'val');
            if (k === 'air' || isAir) setAir({ rh: '', temp: '' });
          };
          // the days of this point side by side: what was read on each, and where it stood
          const tl = pointTimeline(plan, mp);
          const cells = tl.length ? tl : [{ day: { id: 'new' }, name: 'Initial loss', date: todayKey(), reading: null, state: 'none', trend: null }];
          const curId = curDay ? curDay.id : cells[0].day.id;
          const cellText = (c) => {
            const typed = c.day.id === curId ? (isAir ? (air.rh.trim() ? `${air.rh}% RH` : air.temp.trim() ? `${air.temp}°F` : '') : rd.val.trim() ? `${rd.val}${short}` : '') : '';
            if (typed) return { text: typed, live: true };
            const r = c.reading;
            if (!r) return { text: '—' };
            const t = r.val != null ? `${fmtReading(r.val)}${short}` : r.rh != null ? `${fmtReading(r.rh)}% RH` : `${fmtReading(r.temp)}°F`;
            return { text: `${t}${c.trend ? ` ${TREND_MARK[c.trend]}` : ''}` };
          };
          const sub = [roomHere ? roomTitle(roomHere) : 'No room', kind !== 'reading' ? POINT_KINDS[kind] : goal != null ? `dry at ${fmtReading(goal)}${short}` : 'no dry standard yet'].join(' · ');
          const sheet = (
            <div className="sk-sheet" ref={popRef} tabIndex={-1} role="dialog" aria-label={`Moisture point ${mp.n}`} onKeyDown={sheetKey}
              style={phoneSheet ? { pointerEvents: armed ? 'auto' : 'none' } : { bottom: kbPad, maxHeight: `calc(100% - ${kbPad + 8}px)`, pointerEvents: armed ? 'auto' : 'none' }}>
              <div className="sk-sheet-head">
                {!creating && <button type="button" className="sk-nav" aria-label="Previous point" disabled={!prevPt} onClick={() => prevPt && gotoPoint(prevPt.id)}>{'‹'}</button>}
                <div className="sk-sheet-title">
                  <strong><span className="sk-dot" style={{ background: color }} />Point {mp.n}</strong>
                  <span className="muted">{sub}</span>
                </div>
                {creating ? (
                  <button type="button" className="sk-headsave" disabled={!canSave} onClick={() => addReading(null, false)}>Save and close</button>
                ) : (
                  <>
                    <button type="button" className="sk-nav" aria-label="Next point" disabled={!nextPt} onClick={() => nextPt && gotoPoint(nextPt.id)}>{'›'}</button>
                    <button type="button" className="sk-nav" aria-label="Close" onClick={closePopup}>{'×'}</button>
                  </>
                )}
              </div>
              {!recheck && !creating && days.length > 1 && curDay && curDay.date !== todayKey() && (
                <div className="sk-pastday" role="note">You are logging on {dayName(days, curDay.id)} ({dateText(curDay.date)}), not today. Close this and tap Start recheck for today's readings.</div>
              )}
              <div className="sk-strip" role="tablist" aria-label="Readings by day" ref={stripRef}>
                {cells.map((c) => {
                  const cur = c.day.id === curId;
                  const v = cellText(c);
                  return (
                    <button key={c.day.id} type="button" role="tab" aria-selected={cur} className={`sk-sd${cur ? ' on' : ''}`} onClick={() => { if (c.day.id !== 'new') setDayId(c.day.id); }}>
                      <span className="sk-sd-day">{c.name}</span>
                      <span className="sk-sd-date">{dateText(c.date)}</span>
                      <span className={`sk-sd-val${v.live ? ' live' : ''}`} style={v.live ? undefined : { color: MOISTURE_COLORS[c.state] }}>{v.text}</span>
                    </button>
                  );
                })}
              </div>
              {isAir ? (
                <div className="sk-three air">
                  <NumBox big label="RH %" value={air.rh} placeholder={'—'} active={numField === 'rh'} onPick={() => setNumField('rh')} />
                  <NumBox big label={'Temp °F'} value={air.temp} placeholder={'—'} unit={airGpp != null ? `${Math.round(airGpp)} gpp` : ''} active={numField === 'temp'} onPick={() => setNumField('temp')} />
                </div>
              ) : (
                <div className="sk-three">
                  <NumBox big label="Reading" value={rd.val} placeholder="0.0" unit={short.trim()} active={numField === 'val'} onPick={() => setNumField('val')} />
                  <NumBox label="RH %" value={air.rh} placeholder={'—'} active={numField === 'rh'} onPick={() => setNumField('rh')} />
                  <NumBox label={'Temp °F'} value={air.temp} placeholder={'—'} unit={airGpp != null ? `${Math.round(airGpp)} gpp` : ''} active={numField === 'temp'} onPick={() => setNumField('temp')} />
                </div>
              )}
              {rdErr && <div className="msg err" style={{ margin: 0 }}>{rdErr}</div>}
              <MeterScan wantsMoisture={!isAir} onResult={(res) => {
                if (!isAir && res.moisture != null) setRd((r) => ({ ...r, val: fmtReading(res.moisture) }));
                setAir((a) => ({ rh: res.rh != null ? fmtReading(res.rh) : a.rh, temp: res.tempF != null ? fmtReading(res.tempF) : a.temp }));
                setRdErr('');
              }} />
              <div className={`sk-pad${creating ? ' solo' : toRead ? ' two' : ''}`} role="group" aria-label="Number pad">
                {['7', '8', '9'].map((k) => <button key={k} type="button" className="sk-key" onClick={() => padType(k)}>{k}</button>)}
                {['4', '5', '6'].map((k) => <button key={k} type="button" className="sk-key" onClick={() => padType(k)}>{k}</button>)}
                {['1', '2', '3'].map((k) => <button key={k} type="button" className="sk-key" onClick={() => padType(k)}>{k}</button>)}
                <button type="button" className="sk-key" aria-label="Decimal point" onClick={() => padType('.')}>.</button>
                <button type="button" className="sk-key" onClick={() => padType('0')}>0</button>
                <button type="button" className="sk-key fn" aria-label="Backspace" onClick={() => padType('back')}>{'⌫'}</button>
                {!creating && <button type="button" className={`sk-save${toRead ? ' alt' : ''}`} disabled={!canSave} onClick={() => addReading(null, false)}>Save</button>}
                {!creating && toRead && <button type="button" className="sk-save next" aria-label="Save and go to the next point" disabled={!canSave} onClick={() => addReading(null, true)}><span>Save &amp; next</span><b className="sk-arrow" aria-hidden="true">{'›'}</b></button>}
              </div>
              <div className="sk-opt-label sk-kinds-label">Point type</div>
              <div className="sk-kinds" role="group" aria-label="Point type">
                {Object.entries(POINT_KINDS).map(([k, label]) => (
                  <button key={k} type="button" className={kind === k ? 'on' : ''} aria-pressed={kind === k} disabled={kindLocked(k)} title={kindLocked(k) ? 'This point already has readings of another kind' : undefined} onClick={() => setKind(k)}>{label}</button>
                ))}
              </div>
              {!isAir && (
                <div className="sk-setup">
                  <label className="sk-opt">Surface
                    <select value={mp.surface} onChange={(e) => setOpt({ surface: e.target.value })}>
                      {Object.entries(MOISTURE_SURFACES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </label>
                  <label className="sk-opt">Material
                    <select value={mp.material} onChange={(e) => setOpt({ material: e.target.value })}>
                      {Object.entries(MOISTURE_MATERIALS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </label>
                  <label className="sk-opt">Meter reads
                    <select value={mp.type} onChange={(e) => setOpt({ type: e.target.value })}>
                      {Object.entries(MOISTURE_TYPES).map(([k, t]) => <option key={k} value={k}>{t.short.trim()}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {!isAir && mp.surface === 'wall' && (
                <label className="sk-field">Height up the wall
                  <input key={`${mp.id}-h-${mp.h}`} inputMode="decimal" autoComplete="off" defaultValue={mp.h == null ? '' : fmtFeet(mp.h)} placeholder="2'"
                    onBlur={(e) => { const t = e.target.value.trim(); if (t === '') { if (mp.h != null) patchMoisture(mp.id, { h: null }); return; } const ft = parseFeet(t); if (Number.isFinite(ft) && ft <= 30) { if (ft !== mp.h) patchMoisture(mp.id, { h: Math.round(ft * 100) / 100 }); } else e.target.value = mp.h == null ? '' : fmtFeet(mp.h); }}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </label>
              )}
              <label className="sk-field sk-notefield">Note for this reading
                <input maxLength={80} autoComplete="off" enterKeyHint="done" value={rd.note} onChange={(e) => setRd({ ...rd, note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} placeholder="Behind the dishwasher..." />
              </label>
              <details className="sk-more">
                <summary>{`More${ordered.length ? ` · History (${ordered.length})` : ''}`}</summary>
                <div className="sk-details">
                  {ordered.length > 0 && (
                    <>
                      <div className="sk-opt-label">History, newest first</div>
                      <ul className="sk-readings" aria-label="Readings at this point, newest first">
                        {ordered.map((r, i) => {
                          const before = i > 0 ? ordered[i - 1] : null;
                          const tr = before && before.val != null && r.val != null ? (Math.abs(r.val - before.val) < 0.05 ? 'flat' : r.val < before.val ? 'down' : 'up') : null;
                          return (
                            <li key={r.id}>
                              <div><strong>{valueText(mp, r)}</strong>{tr ? ` ${TREND_MARK[tr]}` : ''} {r.val != null && <span className="muted">{airText(r)}</span>}</div>
                              <div className="muted">{dayName(days, r.day) ? `${dayName(days, r.day)} · ` : ''}{whenText(r.at)}{r.by?.name ? ` · ${r.by.name}` : ''}{r.note ? ` · ${r.note}` : ''}</div>
                              {(onAddReadingPhoto || onViewReadingPhotos) && (
                                <div className="sk-rd-photo">
                                  {onViewReadingPhotos && (photoCounts[readingPhotoKey(r.id)] || 0) > 0 && <button type="button" className="secondary small" onClick={() => onViewReadingPhotos(readingPhotoKey(r.id))}>Meter photo ({photoCounts[readingPhotoKey(r.id)]})</button>}
                                  {onAddReadingPhoto && <button type="button" className="secondary small" onClick={() => onAddReadingPhoto(readingPhotoKey(r.id))}>{(photoCounts[readingPhotoKey(r.id)] || 0) > 0 ? 'Add another' : 'Meter photo'}</button>}
                                </div>
                              )}
                              {canDel(r) && <button type="button" className="sk-x" aria-label="Delete this reading" onClick={() => patchMoisture(mp.id, { readings: mp.readings.filter((x) => x.id !== r.id) })}>{'×'}</button>}
                            </li>
                          );
                        }).reverse()}
                      </ul>
                    </>
                  )}
                  {kind === 'reading' && (
                    <label className="sk-field">Dry standard for this point
                      <input key={`${mp.id}-g-${mp.goal}-${mp.material}-${mp.type}`} inputMode="decimal" autoComplete="off" defaultValue={mp.goal == null ? '' : fmtReading(mp.goal)}
                        placeholder={std && std.type === mp.type ? `job standard: ${fmtReading(std.val)}` : 'none'}
                        onBlur={(e) => {
                          const t = e.target.value.trim();
                          if (t === '') { if (mp.goal != null) patchMoisture(mp.id, { goal: null }); return; }
                          const v = parseReading(t);
                          if (Number.isFinite(v) && v <= 100) { if (v !== mp.goal) patchMoisture(mp.id, { goal: v }); } else e.target.value = mp.goal == null ? '' : fmtReading(mp.goal);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                    </label>
                  )}
                  <div className="sk-actions sk-actions-plain">
                    <button type="button" className="secondary" onClick={() => { setMoveId(mp.id); setPopup(null); }}>Move pin</button>
                    <button type="button" className="danger" onClick={() => { if (!mp.readings.length || window.confirm(`Delete point ${mp.n} and its ${mp.readings.length} reading${mp.readings.length === 1 ? '' : 's'}?`)) removeSelected(); }}>Delete point</button>
                  </div>
                </div>
              </details>
            </div>
          );
          // on a phone the sheet is its own layer over the whole screen, sized to what the keyboard leaves free
          return phoneSheet && typeof document !== 'undefined'
            ? createPortal(<div className="sk-sheet-layer" style={vvBox ? { top: vvBox.top, height: vvBox.height } : undefined}>{sheet}</div>, document.body)
            : sheet;
        })()}

        {sheetOpen && eq && (() => {
          const dId = dayRef.current;
          const st = unitAt(plan, eq, dId);
          const ty = EQUIPMENT_TYPES[eq.t] || EQUIPMENT_TYPES.other;
          const here = st.state !== 'none' ? st : unitAt(plan, eq, null);
          const roomHere = hitRoom(plan, here.x, here.y);
          const isOut = st.state === 'out';
          const hist = unitHistory(plan, eq);
          const nDays = daysOnSite(plan, eq, dId);
          const placedBy = eq.log[0] ? eq.log[0].by : null;
          const canDelUnit = isStaffOffice || (!!placedBy?.id && placedBy.id === me.id);
          const lastOut = isOut ? hist.find((h) => h.id === st.entry.id) || null : null;
          const daysText = `${nDays} day${nDays === 1 ? '' : 's'} on site`;
          const sheet = (
            <div className="sk-sheet sk-eq-sheet" ref={popRef} tabIndex={-1} role="dialog" aria-label={`Equipment ${unitCode(eq)}`}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopup(); } }}
              style={phoneSheet ? { pointerEvents: armed ? 'auto' : 'none' } : { bottom: kbPad, maxHeight: `calc(100% - ${kbPad + 8}px)`, pointerEvents: armed ? 'auto' : 'none' }}>
              <div className="sk-sheet-head">
                <div className="sk-sheet-title">
                  <strong><span className="sk-eq-tag" style={{ background: ty.color }}>{unitCode(eq)}</span> {ty.label}</strong>
                  <span className="muted">{roomHere ? roomTitle(roomHere) : 'Outside the rooms'}</span>
                </div>
                <button type="button" className="sk-nav" aria-label="Close" onClick={closePopup}>{'\u00d7'}</button>
              </div>
              <div className="sk-eq-status">
                <span className={`sk-eq-pill${isOut ? ' out' : ''}`}>{isOut ? 'Picked up' : 'On site'}</span>
                <span>{isOut && lastOut ? `${lastOut.day}, ${lastOut.date} \u00b7 ${daysText}` : `${hist[0] ? `Placed ${hist[0].day}, ${hist[0].date} \u00b7 ` : ''}${daysText}`}</span>
              </div>
              {days.length > 1 && curDay && curDay.date !== todayKey() && <div className="sk-pastday" role="note">Logged on {dayName(days, curDay.id)} ({dateText(curDay.date)}), not today.</div>}
              <div className="sk-eq-actions">
                {isOut ? (
                  <button type="button" className="primary" onClick={() => equipChangeState('putback')}>Put back</button>
                ) : (
                  <>
                    <button type="button" className="secondary" onClick={() => { setMoveEqId(eq.id); setPopup(null); }}>Move</button>
                    <button type="button" className="secondary" onClick={() => equipChangeState('pickup')}>Pick up</button>
                  </>
                )}
              </div>
              <div className="sk-eq-fields">
                <label className="sk-opt full">Equipment
                  <select value={eq.t} onChange={(e) => { const t = e.target.value; if (t === eq.t) return; const others = planRef.current.equipment.filter((x) => x.id !== eq.id); patchEquip(eq.id, { t, n: nextEquipNumber(others, t) }); }}>
                    {EQUIPMENT_GROUPS.map((g) => (
                      <optgroup key={g} label={g}>
                        {EQUIPMENT_ORDER.filter((k) => EQUIPMENT_TYPES[k].group === g).map((k) => <option key={k} value={k}>{EQUIPMENT_TYPES[k].label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {assets && (
                  <button type="button" className="sk-scan-btn full" onClick={() => setScanFor(eq.id)}><CameraIcon /> {eq.asset ? 'Scan a different asset tag' : 'Scan asset tag'}</button>
                )}
                {assets && (
                  <label className="sk-field full">Asset tag (company inventory)
                    <select value={eq.asset || ''} onChange={(e) => {
                      const a = assets.list.find((x) => x.id === e.target.value);
                      if (!a) { patchEquip(eq.id, { asset: undefined }); return; }
                      const patch = { asset: a.id };
                      if (!eq.label && a.label) patch.label = a.label.slice(0, 40);
                      if (!eq.ppd && a.ppd) patch.ppd = a.ppd;
                      patchEquip(eq.id, patch);
                    }}>
                      <option value="">None</option>
                      {assets.list.filter((a) => a.id === eq.asset || (a.status === 'available' && a.type === eq.t)).map((a) => <option key={a.id} value={a.id}>{a.tag}{a.label ? ` - ${a.label}` : ''}</option>)}
                    </select>
                  </label>
                )}
                <label className="sk-field">Model or unit no.
                  <input key={`l-${eq.id}`} defaultValue={eq.label} maxLength={40} placeholder="Optional" onBlur={(e) => { const t = e.target.value.trim(); if (t !== eq.label) patchEquip(eq.id, { label: t }); }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </label>
                {EQUIPMENT_TYPES[eq.t].group === 'Dehumidifiers' && (
                  <label className="sk-field">Pints per day (rating)
                    <input key={`p-${eq.id}-${eq.ppd || ''}`} inputMode="numeric" defaultValue={eq.ppd || ''} placeholder="e.g. 70" onBlur={(e) => { const n = Math.round(Number(e.target.value)); const next = Number.isFinite(n) && n > 0 && n <= 999 ? n : 0; if (next !== (eq.ppd || 0)) { patchEquip(eq.id, { ppd: next || undefined }); } }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                  </label>
                )}
                <label className="sk-field">Note
                  <input key={`n-${eq.id}`} defaultValue={eq.note} maxLength={80} placeholder="Optional" onBlur={(e) => { const t = e.target.value.trim(); if (t !== eq.note) patchEquip(eq.id, { note: t }); }} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                </label>
              </div>
              {/^dehu|^desiccant$/.test(eq.t) && (
                <details>
                  <summary>Inlet / outlet readings ({(eq.dr || []).length})</summary>
                  <div className="sk-details">
                    <DehuReadings plan={plan} unit={eq} dayId={dayRef.current} by={meRef.current} atForNow={() => atForDay(curDay)} onChange={(u) => patchEquip(eq.id, { dr: u.dr })} />
                  </div>
                </details>
              )}
              <details>
                <summary>History ({hist.length})</summary>
                <div className="sk-details">
                  <ol className="sk-eq-hist">
                    {hist.map((h) => <li key={h.id}><strong>{h.text}</strong><span>{h.day}, {h.date} {'\u00b7'} {h.room}{h.by ? ` \u00b7 ${h.by}` : ''}</span></li>)}
                  </ol>
                  {canDelUnit && <button type="button" className="danger small" onClick={() => { if (window.confirm(`Delete ${unitCode(eq)}? It is removed from every day, as if it was never placed. To keep it in the log, pick it up instead.`)) removeSelected(); }}>Delete {unitCode(eq)}</button>}
                </div>
              </details>
            </div>
          );
          return phoneSheet && typeof document !== 'undefined'
            ? createPortal(<div className="sk-sheet-layer" style={vvBox ? { top: vvBox.top, height: vvBox.height } : undefined}>{sheet}</div>, document.body)
            : sheet;
        })()}
      </div>

      {scanFor && <AssetScan onScan={applyScan} onClose={() => setScanFor(null)} />}
      {dayOneOpen && <DayOneList items={dayOne.items} onClose={() => setDayOneOpen(false)} />}
      <RoomBySize open={sizeOpen} onClose={() => setSizeOpen(false)} rooms={plan.rooms} selectedId={sel && sel.kind === 'room' ? sel.id : null} onAdd={addRoomBySize} onTrace={() => { setSizeOpen(false); setTraceOpen(true); }} />
      <RoomTrace open={traceOpen} onClose={() => setTraceOpen(false)} onAdd={addTracedRoom} />

      {stdOpen && (
        <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setStdOpen(false); }}>
          <div className="sketch-modal-card sk-std" role="dialog" aria-label="Dry standards">
            <div className="sketch-pop-head"><strong>Dry standards for this job</strong><button type="button" className="sk-x" aria-label="Close" onClick={() => setStdOpen(false)}>{'\u00d7'}</button></div>
            <p className="muted" style={{ margin: 0 }}>The reading of each material in an unaffected area. A point is dry when its latest reading is at or under its standard. A point can have its own standard under More in its sheet. Dry standard points on the plan are measured and used first.</p>
            <div className="sk-std-list">
              {Object.entries(MOISTURE_MATERIALS).map(([k, label]) => {
                const st = plan.standards[k];
                return (
                  <div className="sk-std-row" key={`${k}-${st ? st.val : ''}-${st ? st.type : ''}`}>
                    <span>{label}</span>
                    <input inputMode="decimal" aria-label={`${label} dry standard`} defaultValue={st ? fmtReading(st.val) : ''} placeholder="none"
                      onBlur={(e) => { if (!setStandard(k, e.target.value, st ? st.type : 'mc')) e.target.value = st ? fmtReading(st.val) : ''; }}
                      onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
                    <select aria-label={`${label} reading type`} value={st ? st.type : 'mc'} disabled={!st} onChange={(e) => setStandard(k, fmtReading(st.val), e.target.value)}>
                      {Object.entries(MOISTURE_TYPES).map(([tk, t]) => <option key={tk} value={tk}>{t.label}</option>)}
                    </select>
                    {Object.entries(MOISTURE_TYPES).map(([tk, t]) => { const mv = measuredStandard(plan, k, tk); return mv == null ? null : <div key={tk} className="sk-std-note">Measured {fmtReading(mv)}{t.short} at the dry standard points: used for {label.toLowerCase()} points</div>; })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {exportOpen && (
        <div className="sketch-modal" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) setExportOpen(false); }}>
          <div className="sketch-modal-card" role="dialog" aria-label="Export sketch">
            <div className="sketch-pop-head"><strong>Export sketch</strong><button type="button" className="sk-x" aria-label="Close" onClick={() => setExportOpen(false)}>{'\u00d7'}</button></div>
            {(() => {
              const mm = sharedWallMismatches(plan);
              const name = (id) => { const r = plan.rooms.find((x) => x.id === id); return r ? `${r.num ? `#${r.num} ` : ''}${roomTitle(r)}` : 'Room'; };
              if (!mm.length) return null;
              return (
                <div className="sk-checks" role="note">
                  {mm.map((m, i) => <div key={i}><strong>Shared wall differs:</strong> {name(m.a)} says {fmtFeet(m.lenA)}, {name(m.b)} says {fmtFeet(m.lenB)}.</div>)}
                </div>
              );
            })()}
            <button type="button" className="secondary" onClick={() => exportAs('png')}>Export as PNG</button>
            <button type="button" className="secondary" onClick={() => exportAs('pdf')}>Export as PDF</button>
            {mode === 'moisture' && <button type="button" className="primary" disabled={!plan.moisture.length && !plan.equipment.length} onClick={() => exportAs('report')} title="Floor plan, readings by day, drying curves, dry dates, equipment placed and the full log">Customer report (PDF)</button>}
            {mode === 'moisture' && <button type="button" className="secondary" disabled={!plan.moisture.length && !plan.equipment.length} onClick={() => exportAs('summary-report')} title="The first page: status, the floor plan and a result for each room">Summary report (PDF)</button>}
            {mode === 'moisture' && <button type="button" className="secondary" disabled={!plan.equipment.length} onClick={() => exportAs('equipment-report')} title="What equipment was set, where, for how long, and how the dehumidifiers performed">Equipment report (PDF)</button>}
            {mode === 'moisture' && <button type="button" className="secondary" disabled={!plan.moisture.length && !plan.equipment.length} onClick={() => exportAs('carrier-report')} title="The full report plus a map page for each room and dehumidifier performance">Carrier packet (PDF)</button>}
            {mode === 'moisture' && <button type="button" className="secondary" disabled={!plan.moisture.length} onClick={() => exportAs('summary')} title="One row per point, one column per day">Daily summary (CSV)</button>}
            {mode === 'moisture' && <button type="button" className="secondary" disabled={!plan.moisture.length} onClick={() => exportAs('csv')} title="Every reading at every point, oldest first">Full moisture log (CSV)</button>}
            {mode === 'moisture' && reportInfo?.jobId && <button type="button" className="secondary" disabled={!plan.equipment.length} onClick={() => exportAs('labels')} title="A sheet of QR labels, one per machine; scanning one opens that unit on this job">Equipment QR labels (PDF)</button>}
            {mode === 'moisture' && <button type="button" className="secondary" disabled={!plan.equipment.length} onClick={() => exportAs('equipment')} title="One row per piece of equipment: where, when placed and picked up, days on site">Equipment log (CSV)</button>}
          </div>
        </div>
      )}
      <div className="sketch-summary">
        {plan.rooms.length} room{plan.rooms.length === 1 ? '' : 's'}{plan.rooms.length > 0 && <> · {total.toLocaleString()} sq ft total</>}
        {['water', 'growth', 'smoke'].filter((kd) => totals.total[kd]).map((kd) => (
          <span key={kd}> · <strong style={{ color: kindDot(kd) }}>{AREA_KINDS[kd]} {surfaceText(totals.total[kd])} sq ft</strong></span>
        ))}
        {plan.objects.length > 0 && <> · <span title={objectCounts(plan).map((c) => `${c.count} ${c.label.toLowerCase()}`).join(', ')}>{plan.objects.length} object{plan.objects.length === 1 ? '' : 's'}</span></>}
        {mode === 'moisture' && plan.moisture.length > 0 && (() => {
          const c = moistureCounts(dayPlan);
          return <>{c.points > 0 && <> · <strong>{c.points} moisture point{c.points === 1 ? '' : 's'}</strong></>}{c.standards > 0 && <> · <strong style={{ color: MOISTURE_COLORS.standard }}>{c.standards} dry standard{c.standards === 1 ? '' : 's'}</strong></>}{c.air > 0 && <> · <strong style={{ color: MOISTURE_COLORS.air }}>{c.air} air point{c.air === 1 ? '' : 's'}</strong></>}{c.wet > 0 && <> · <strong style={{ color: MOISTURE_COLORS.wet }}>{c.wet} wet</strong></>}{c.dry > 0 && <> · <strong style={{ color: MOISTURE_COLORS.dry }}>{c.dry} dry</strong></>}{c.none > 0 && <> · <strong>{c.none} to read</strong></>}</>;
        })()}
        {mode === 'moisture' && plan.equipment.length > 0 && <> · <strong style={{ color: '#1c7ed6' }} title={countText(eqCounts)}>{eqCounts.total} equipment on site</strong></>}
        {plan.sources.length > 0 && <> · <strong style={{ color: kindDot('source') }}>{plan.sources.length} source{plan.sources.length === 1 ? '' : 's'} of loss</strong></>}
        <span className="muted sk-hint"> · {tool === 'area' ? AREA_HINTS[areaKind] : mode === 'moisture' && work === 'equipment' ? HINTS.equipment : HINTS[tool]}</span>
      </div>
    </div>
  );
}
