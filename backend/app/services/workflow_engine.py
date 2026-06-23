"""LangGraph 工作流执行引擎：定义 DAG 执行逻辑"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, StateGraph


# 工作流状态定义
class WorkflowState(dict):
    """工作流执行状态，在节点间传递"""

    project_id: str
    nodes: list[dict[str, Any]]  # 节点列表
    edges: list[dict[str, Any]]  # 边列表
    results: dict[str, Any]  # 各节点的执行结果
    errors: dict[str, str]  # 各节点的错误信息


def _build_dag(nodes: list[dict], edges: list[dict]) -> dict[str, list[str]]:
    """根据节点和边构建邻接表（DAG）"""
    adjacency: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        adjacency[edge["source_node_id"]].append(edge["target_node_id"])
    return adjacency


def _find_entry_nodes(adjacency: dict[str, list[str]], all_node_ids: set[str]) -> list[str]:
    """找到 DAG 的入口节点（无入边的节点）"""
    targets = {t for targets in adjacency.values() for t in targets}
    return list(all_node_ids - targets)


async def execute_node(node: dict[str, Any], state: WorkflowState) -> dict:
    """执行单个节点（骨架实现）"""
    node_type = node.get("node_type", "unknown")
    # TODO: 根据 node_type 分发到具体的 AI 服务
    return {"node_id": node["id"], "output": f"placeholder_result_for_{node_type}"}


def create_workflow_engine(nodes: list[dict], edges: list[dict]) -> StateGraph:
    """根据节点和边创建 LangGraph 工作流图"""
    graph = StateGraph(WorkflowState)
    adjacency = _build_dag(nodes, edges)
    all_node_ids = {n["id"] for n in nodes}

    # 添加节点到图中
    for node in nodes:
        graph.add_node(node["id"], execute_node)

    # 添加边到图中
    for source_id, target_ids in adjacency.items():
        if not target_ids:
            # 无后继节点，指向 END
            graph.add_edge(source_id, END)
        else:
            for target_id in target_ids:
                graph.add_edge(source_id, target_id)

    # 设置入口节点
    entry_nodes = _find_entry_nodes(adjacency, all_node_ids)
    if entry_nodes:
        graph.set_entry_point(entry_nodes[0])

    return graph
