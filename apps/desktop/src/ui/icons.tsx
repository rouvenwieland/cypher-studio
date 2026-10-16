/**
 * Symbole: Phosphor Icons (MIT), Gewicht Regular, einzeln importiert (DESIGN.md „icons“).
 * Dazu sechs eigene Fachglyphen auf Phosphors 256er-Raster mit Strich 16 und ein gestricheltes Quadrat (Status „nicht geprüft“).
 */
import type { ComponentType, SVGProps } from "react";
import type { IconProps } from "@phosphor-icons/react";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowsOut } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { Aperture } from "@phosphor-icons/react/dist/csr/Aperture";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckSquare } from "@phosphor-icons/react/dist/csr/CheckSquare";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { Command } from "@phosphor-icons/react/dist/csr/Command";
import { Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { CornersOut } from "@phosphor-icons/react/dist/csr/CornersOut";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { Eraser } from "@phosphor-icons/react/dist/csr/Eraser";
import { Eye } from "@phosphor-icons/react/dist/csr/Eye";
import { FilmStrip } from "@phosphor-icons/react/dist/csr/FilmStrip";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { FrameCorners } from "@phosphor-icons/react/dist/csr/FrameCorners";
import { Funnel } from "@phosphor-icons/react/dist/csr/Funnel";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import { GridFour } from "@phosphor-icons/react/dist/csr/GridFour";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import { HardDrives } from "@phosphor-icons/react/dist/csr/HardDrives";
import { House } from "@phosphor-icons/react/dist/csr/House";
import { Image } from "@phosphor-icons/react/dist/csr/Image";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Keyboard } from "@phosphor-icons/react/dist/csr/Keyboard";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { Lock } from "@phosphor-icons/react/dist/csr/Lock";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Package } from "@phosphor-icons/react/dist/csr/Package";
import { Palette } from "@phosphor-icons/react/dist/csr/Palette";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Printer } from "@phosphor-icons/react/dist/csr/Printer";
import { Rows } from "@phosphor-icons/react/dist/csr/Rows";
import { Ruler } from "@phosphor-icons/react/dist/csr/Ruler";
import { Scissors } from "@phosphor-icons/react/dist/csr/Scissors";
import { SelectionBackground } from "@phosphor-icons/react/dist/csr/SelectionBackground";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { ShieldWarning } from "@phosphor-icons/react/dist/csr/ShieldWarning";
import { SquaresFour } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { Stop } from "@phosphor-icons/react/dist/csr/Stop";
import { Tag } from "@phosphor-icons/react/dist/csr/Tag";
import { TShirt } from "@phosphor-icons/react/dist/csr/TShirt";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { WarningOctagon } from "@phosphor-icons/react/dist/csr/WarningOctagon";
import { X } from "@phosphor-icons/react/dist/csr/X";

export type IconComponent = ComponentType<{ size?: number; weight?: IconProps["weight"]; className?: string }>;

/** Phosphor-Symbol mit Standardgröße 16 und ohne Ansage durch Screenreader (Name steht am Knopf). */
function wrap(Base: ComponentType<IconProps>): IconComponent {
  const Wrapped: IconComponent = ({ size = 16, weight = "regular", className }) => (
    <Base size={size} weight={weight} aria-hidden="true" focusable="false" {...(className ? { className } : {})} />
  );
  return Wrapped;
}

export const IconHome = wrap(House);
export const IconLibrary = wrap(FolderOpen);
export const IconPrograms = wrap(Package);
export const IconPrint = wrap(Printer);
export const IconMockup = wrap(TShirt);
export const IconSocial = wrap(FrameCorners);
export const IconCutout = wrap(SelectionBackground);
export const IconSettings = wrap(Gear);
export const IconJobs = wrap(ListChecks);
export const IconFolder = wrap(FolderSimple);
export const IconSearch = wrap(MagnifyingGlass);
export const IconClose = wrap(X);
export const IconCheck = wrap(Check);
export const IconPlus = wrap(Plus);
export const IconMinus = wrap(Minus);
export const IconPlay = wrap(Play);
export const IconStop = wrap(Stop);
export const IconCopy = wrap(Copy);
export const IconMore = wrap(DotsThree);
export const IconDown = wrap(CaretDown);
export const IconRight = wrap(CaretRight);
export const IconBack = wrap(ArrowLeft);
export const IconNext = wrap(ArrowRight);
export const IconExternal = wrap(ArrowSquareOut);
export const IconRefresh = wrap(ArrowsClockwise);
export const IconRetry = wrap(ArrowClockwise);
export const IconUndo = wrap(ArrowCounterClockwise);
export const IconFit = wrap(ArrowsOut);
export const IconActualSize = wrap(CornersOut);
export const IconGrid = wrap(GridFour);
export const IconList = wrap(List);
export const IconRows = wrap(Rows);
export const IconTiles = wrap(SquaresFour);
export const IconEye = wrap(Eye);
export const IconUpload = wrap(UploadSimple);
export const IconDownload = wrap(DownloadSimple);
export const IconErase = wrap(Eraser);
export const IconFilter = wrap(Funnel);
export const IconTag = wrap(Tag);
export const IconLock = wrap(Lock);
export const IconClock = wrap(Clock);
export const IconShield = wrap(ShieldCheck);
export const IconShieldWarning = wrap(ShieldWarning);
export const IconKeyboard = wrap(Keyboard);
export const IconCommand = wrap(Command);
export const IconPalette = wrap(Palette);
export const IconImage = wrap(Image);
export const IconFilm = wrap(FilmStrip);
export const IconAperture = wrap(Aperture);
export const IconRuler = wrap(Ruler);
export const IconDrive = wrap(HardDrives);
export const IconInfo = wrap(Info);
export const IconTrash = wrap(Trash);
export const IconHand = wrap(Hand);
export const IconScissors = wrap(Scissors);

/** Status-Glyphen, Gewicht „fill“ nur hier (DESIGN.md icons.gewichte). */
export const GlyphOk: IconComponent = ({ size = 16, className }) => <CheckSquare size={size} weight="fill" aria-hidden="true" focusable="false" {...(className ? { className } : {})} />;
export const GlyphWarn: IconComponent = ({ size = 16, className }) => <Warning size={size} weight="fill" aria-hidden="true" focusable="false" {...(className ? { className } : {})} />;
export const GlyphError: IconComponent = ({ size = 16, className }) => <WarningOctagon size={size} weight="fill" aria-hidden="true" focusable="false" {...(className ? { className } : {})} />;
export const GlyphInfo = wrap(Info);

type SvgProps = SVGProps<SVGSVGElement> & { size?: number };

function Glyph({ size = 16, children, ...rest }: SvgProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={16} strokeLinecap="butt" strokeLinejoin="miter" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/** Noch nicht geprüft: gestricheltes Quadrat (Status „offen“). */
export const GlyphOpen: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})} strokeDasharray="32 24">
    <rect x="40" y="40" width="176" height="176" />
  </Glyph>
);

/** Eigene Glyphen (DESIGN.md: Druckfläche, Sicherheitszone, Prüfsumme, Messspur, Umfeld, Bandbreite). */
export const GlyphPrintArea: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})}>
    <rect x="48" y="32" width="160" height="192" />
    <path d="M128 32v32M128 192v32M48 128h32M176 128h32" />
  </Glyph>
);
export const GlyphSafeZone: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})}>
    <rect x="32" y="32" width="192" height="192" />
    <rect x="80" y="80" width="96" height="96" strokeDasharray="24 16" />
  </Glyph>
);
export const GlyphChecksum: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})}>
    <path d="M96 40 80 216M176 40 160 216M40 100h176M32 156h176" />
  </Glyph>
);
export const GlyphMeasure: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})}>
    <path d="M32 80v96M224 80v96M32 128h192M80 104v48M128 112v32M176 104v48" />
  </Glyph>
);
export const GlyphSurround: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})}>
    <rect x="32" y="32" width="192" height="192" />
    <path d="M128 32v192" />
    <path d="M128 32h96v192h-96z" fill="currentColor" stroke="none" opacity="0.35" />
  </Glyph>
);
export const GlyphBandwidth: IconComponent = ({ size = 16, className }) => (
  <Glyph size={size} {...(className ? { className } : {})}>
    <path d="M40 48v160M216 48v160M72 128h112M96 104l-24 24 24 24M160 104l24 24-24 24" />
  </Glyph>
);
