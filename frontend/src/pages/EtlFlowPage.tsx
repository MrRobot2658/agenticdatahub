import { useCallback, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, useReactFlow,
  Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  FileSpreadsheet, Database, Radio, Cloud,
  Wand2, Filter, Type, Link2,
  Boxes, Megaphone, Webhook, Warehouse,
  Trash2, Save, Sparkles, type LucideIcon,
} from "lucide-react";
import Layout from "../components/layout/Layout";
import { Button } from "../components/ui";
import { MockTag } from "../components/segment/kit";
import { useLang } from "../context/LangContext";

type Tr = (zh: string, en?: string) => string;

// 节点类别 —— source 只出、destination 只进、transform 进出
type Kind = "source" | "transform" | "destination";
interface NodeMeta { label: string; term: string; icon: LucideIcon; kind: Kind }

// 调色板（左侧可拖拽节点），按 source → transform → destination 分组
const buildPalette = (tr: Tr): { group: string; kind: Kind; items: (NodeMeta & { type: string })[] }[] => [
  {
    group: tr("数据源 Sources", "Sources"), kind: "source", items: [
      { type: "csv", label: tr("CSV / 粘贴", "CSV / Paste"), term: "CSV", icon: FileSpreadsheet, kind: "source" },
      { type: "mysql", label: "MySQL", term: "MySQL", icon: Database, kind: "source" },
      { type: "kafka", label: "Kafka", term: "Kafka", icon: Radio, kind: "source" },
      { type: "api", label: "REST API", term: "API", icon: Cloud, kind: "source" },
    ],
  },
  {
    group: tr("转换 Transforms", "Transforms"), kind: "transform", items: [
      { type: "map", label: tr("字段映射", "Field Map"), term: "Field Map", icon: Wand2, kind: "transform" },
      { type: "filter", label: tr("过滤", "Filter"), term: "Filter", icon: Filter, kind: "transform" },
      { type: "cast", label: tr("类型转换", "Cast"), term: "Cast", icon: Type, kind: "transform" },
      { type: "relation", label: tr("建立关系", "Relation"), term: "Relation", icon: Link2, kind: "transform" },
    ],
  },
  {
    group: tr("目的地 Destinations", "Destinations"), kind: "destination", items: [
      { type: "object", label: tr("对象表", "Objects"), term: "Objects", icon: Boxes, kind: "destination" },
      { type: "ads", label: tr("广告平台", "Ads"), term: "Ads", icon: Megaphone, kind: "destination" },
      { type: "webhook", label: "Webhook", term: "Webhook", icon: Webhook, kind: "destination" },
      { type: "warehouse", label: tr("数据仓库", "Warehouse"), term: "Warehouse", icon: Warehouse, kind: "destination" },
    ],
  },
];

// 扁平注册表：drop 时按 type 还原完整元数据（含图标，无法走 dataTransfer 序列化）
const buildNodeMeta = (tr: Tr): Record<string, NodeMeta> => Object.fromEntries(
  buildPalette(tr).flatMap((g) => g.items.map((i) => [i.type, { label: i.label, term: i.term, icon: i.icon, kind: i.kind }])),
);

const KIND_STYLE: Record<Kind, { box: string; chip: string; dot: string }> = {
  source: { box: "border-brand-300 bg-brand-50", chip: "bg-brand-100 text-brand-700", dot: "!bg-brand-500" },
  transform: { box: "border-gray-300 bg-white", chip: "bg-gray-100 text-gray-600", dot: "!bg-gray-400" },
  destination: { box: "border-amber-300 bg-amber-50", chip: "bg-amber-100 text-amber-700", dot: "!bg-amber-500" },
};

const handleCls = "h-2.5 w-2.5 rounded-full border-2 border-white";

// 自定义节点：左 target 把手 / 右 source 把手（按类别裁剪）
function EtlNode({ data }: NodeProps) {
  const meta = data as unknown as NodeMeta;
  const Icon = meta.icon;
  const s = KIND_STYLE[meta.kind];
  return (
    <div className={`w-44 rounded-xl border px-3 py-2.5 shadow-card ${s.box}`}>
      {meta.kind !== "source" && (
        <Handle type="target" position={Position.Left} className={`${handleCls} ${s.dot}`} />
      )}
      <div className="flex items-center gap-2.5">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.chip}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-gray-900">{meta.label}</div>
          <div className="truncate text-[11px] text-gray-400">{meta.term}</div>
        </div>
      </div>
      {meta.kind !== "destination" && (
        <Handle type="source" position={Position.Right} className={`${handleCls} ${s.dot}`} />
      )}
    </div>
  );
}

const nodeTypes = { etl: EtlNode };

const defaultEdgeOptions = {
  animated: true,
  style: { stroke: "#52bd94", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#52bd94" },
};

// 示例流程：CSV → 字段映射 → 对象表
const buildSeedNodes = (tr: Tr): Node[] => {
  const meta = buildNodeMeta(tr);
  return [
    { id: "n-csv", type: "etl", position: { x: 40, y: 140 }, data: { ...meta.csv } },
    { id: "n-map", type: "etl", position: { x: 300, y: 140 }, data: { ...meta.map } },
    { id: "n-obj", type: "etl", position: { x: 560, y: 140 }, data: { ...meta.object } },
  ];
};
const SEED_EDGES: Edge[] = [
  { id: "e1", source: "n-csv", target: "n-map" },
  { id: "e2", source: "n-map", target: "n-obj" },
];

function FlowCanvas() {
  const { tr } = useLang();
  const PALETTE = useMemo(() => buildPalette(tr), [tr]);
  const NODE_META = useMemo(() => buildNodeMeta(tr), [tr]);
  const SEED_NODES = useMemo(() => buildSeedNodes(tr), [tr]);
  const wrapper = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);
  const [nodes, setNodes, onNodesChange] = useNodesState(SEED_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(SEED_EDGES);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/etlnode");
      const meta = NODE_META[type];
      if (!meta) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `n-${type}-${idRef.current++}`;
      setNodes((nds) => nds.concat({ id, type: "etl", position, data: { ...meta } }));
    },
    [screenToFlowPosition, setNodes, NODE_META],
  );

  const clear = () => { setNodes([]); setEdges([]); };
  const loadSeed = () => { setNodes(SEED_NODES); setEdges(SEED_EDGES); };

  return (
    <div className="flex h-[680px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-card">
      {/* 左侧：可拖拽节点面板 */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-3">
        <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {tr("节点 · 拖到右侧画布", "Nodes · drag onto canvas")}
        </div>
        {PALETTE.map((g) => (
          <div key={g.group} className="mb-4">
            <div className="mb-1.5 px-1 text-[11px] font-semibold text-gray-500">{g.group}</div>
            <div className="space-y-1.5">
              {g.items.map((it) => {
                const s = KIND_STYLE[it.kind];
                return (
                  <div
                    key={it.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/etlnode", it.type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="flex cursor-grab items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-gray-700 transition-shadow hover:shadow-md active:cursor-grabbing"
                  >
                    <div className={`flex h-6 w-6 items-center justify-center rounded-md ${s.chip}`}>
                      <it.icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="flex-1 truncate">{it.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </aside>

      {/* 右侧：流程画布 */}
      <div className="relative flex-1" ref={wrapper}>
        <div className="absolute left-3 top-3 z-10 flex gap-2">
          <Button variant="outline" onClick={loadSeed} className="!py-1.5 !text-xs">
            <Sparkles className="h-3.5 w-3.5" /> {tr("示例流程", "Example flow")}
          </Button>
          <Button variant="outline" onClick={clear} className="!py-1.5 !text-xs">
            <Trash2 className="h-3.5 w-3.5" /> {tr("清空", "Clear")}
          </Button>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} color="#e4e7ec" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#a8ecca" maskColor="rgba(0,0,0,0.04)" />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function EtlFlowPage() {
  const { tr } = useLang();
  const [saved, setSaved] = useState(false);
  return (
    <Layout
      title={tr("可视化编排 Pipelines", "Pipelines")}
      subtitle={tr("从数据源到目的地：左侧拖出节点，在画布上连线编排 ETL 流程（拖拽节点、连接把手、Backspace 删除）", "From sources to destinations: drag nodes from the left and connect them on the canvas to orchestrate ETL flows (drag nodes, connect handles, Backspace to delete)")}
      actions={
        <>
          <MockTag>{tr("未接后端", "No backend")}</MockTag>
          <Button onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 1800); }}>
            <Save className="h-4 w-4" /> {saved ? tr("已保存", "Saved") : tr("保存流程", "Save flow")}
          </Button>
        </>
      }
    >
      <ReactFlowProvider>
        <FlowCanvas />
      </ReactFlowProvider>
    </Layout>
  );
}
