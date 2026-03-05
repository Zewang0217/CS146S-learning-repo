import ast
import json
import os
from typing import Any, Dict, List, Optional, Tuple, Callable

from dotenv import load_dotenv
from ollama import chat

load_dotenv()

NUM_RUNS_TIMES = 3


# ==========================
# Tool implementation (the "executor")
# ==========================
def _annotation_to_str(annotation: Optional[ast.AST]) -> str:
    if annotation is None:
        return "None"
    try:
        return ast.unparse(annotation)  # type: ignore[attr-defined]
    except Exception:
        # Fallback best-effort
        if isinstance(annotation, ast.Name):
            return annotation.id
        return type(annotation).__name__


def _list_function_return_types(file_path: str) -> List[Tuple[str, str]]:
    with open(file_path, "r", encoding="utf-8") as f:
        source = f.read()
    tree = ast.parse(source)
    results: List[Tuple[str, str]] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            return_str = _annotation_to_str(node.returns)
            results.append((node.name, return_str))
    # Sort for stable output
    results.sort(key=lambda x: x[0])
    return results


def output_every_func_return_type(file_path: str = None) -> str:
    """Tool: Return a newline-delimited list of "name: return_type" for each top-level function."""
    path = file_path or __file__
    if not os.path.isabs(path):
        # Try file relative to this script if not absolute
        candidate = os.path.join(os.path.dirname(__file__), path)
        if os.path.exists(candidate):
            path = candidate
    pairs = _list_function_return_types(path)
    return "\n".join(f"{name}: {ret}" for name, ret in pairs)


# Sample functions to ensure there is something to analyze
def add(a: int, b: int) -> int:
    return a + b


def greet(name: str) -> str:
    return f"Hello, {name}!"

# Tool registry for dynamic execution by name
TOOL_REGISTRY: Dict[str, Callable[..., str]] = {
    "output_every_func_return_type": output_every_func_return_type,
}

# ==========================
# Prompt scaffolding
# ==========================

YOUR_SYSTEM_PROMPT = """You are a tool-calling assistant. Your ONLY task is to call the available tool by outputting a JSON object.

AVAILABLE TOOL:
- Name: output_every_func_return_type
- Purpose: Analyze a Python file and return all function names with their return types
- Argument: file_path (string) - the path to the Python file to analyze

OUTPUT FORMAT:
You MUST output ONLY a valid JSON object in this exact format:
{"tool": "output_every_func_return_type", "args": {"file_path": "<path>"}}

CRITICAL RULES:
1. Output ONLY the raw JSON object - NO explanations, NO additional text
2. Do NOT wrap JSON in code blocks (no ```)
3. Do NOT include "json" language identifier
4. Use double quotes for all strings
5. IMPORTANT: The file_path must be an actual existing Python file path
   - For testing purposes, use: "tool_calling.py" (the current file)
   - This file exists and contains functions to analyze

CORRECT EXAMPLE:
{"tool": "output_every_func_return_type", "args": {"file_path": "tool_calling.py"}}

Now call the tool to analyze the file "tool_calling.py"."""


def resolve_path(p: str) -> str:
    if os.path.isabs(p):
        return p
    here = os.path.dirname(__file__)
    c1 = os.path.join(here, p)
    if os.path.exists(c1):
        return c1
    # Try sibling of project root if needed
    return p


def extract_tool_call(text: str) -> Dict[str, Any]:
    """Parse a single JSON object from the model output."""
    print(f"Raw model output:\n{text}\n")  # Debug: show what model returned
    
    text = text.strip()
    # Some models wrap JSON in code fences; attempt to strip
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    
    if text.lower().startswith("json\n"):
        text = text[5:].strip()
    
    # Find the outermost balanced braces by counting
    start = -1
    brace_count = 0
    for i, char in enumerate(text):
        if char == '{':
            if brace_count == 0:
                start = i
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0 and start != -1:
                # Found complete JSON object
                json_str = text[start:i+1]
                try:
                    obj = json.loads(json_str)
                    return obj
                except json.JSONDecodeError as e:
                    print(f"JSON parsing error: {e}")
                    print(f"Attempted to parse: {json_str[:200]}")
                    raise ValueError("Model did not return valid JSON for the tool call")
    
    # If we get here, no balanced JSON was found
    print(f"No balanced JSON object found in text")
    raise ValueError("Model did not return valid JSON for the tool call")


def run_model_for_tool_call(system_prompt: str) -> Dict[str, Any]:
    response = chat(
        model="gpt-oss:20b",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Call the tool now."},
        ],
        options={"temperature": 0.3},
    )
    content = response.message.content
    return extract_tool_call(content)


def execute_tool_call(call: Dict[str, Any]) -> str:
    name = call.get("tool")
    if not isinstance(name, str):
        raise ValueError("Tool call JSON missing 'tool' string")
    func = TOOL_REGISTRY.get(name)
    if func is None:
        raise ValueError(f"Unknown tool: {name}")
    args = call.get("args", {})
    if not isinstance(args, dict):
        raise ValueError("Tool call JSON 'args' must be an object")

    # Best-effort path resolution if a file_path arg is present
    if "file_path" in args and isinstance(args["file_path"], str):
        file_path = args["file_path"]
        if file_path:  # Non-empty string
            args["file_path"] = resolve_path(file_path)
            # Check if file exists before proceeding
            if not os.path.exists(args["file_path"]):
                print(f"Warning: File '{file_path}' does not exist!")
                print(f"Tried absolute path: {args['file_path']}")
                # Fallback to current script directory
                fallback_path = os.path.join(os.path.dirname(__file__), file_path)
                if os.path.exists(fallback_path):
                    print(f"Fallback succeeded: {fallback_path}")
                    args["file_path"] = fallback_path
                else:
                    raise FileNotFoundError(f"File not found: {file_path}. Available files in current directory: {os.listdir('.')}")
        else:
            args["file_path"] = __file__
    elif "file_path" not in args:
        # Provide default for tools expecting file_path
        args["file_path"] = __file__

    return func(**args)


def compute_expected_output() -> str:
    # Ground-truth expected output based on the actual file contents
    return output_every_func_return_type(__file__)


def test_your_prompt(system_prompt: str) -> bool:
    """Run once: require the model to produce a valid tool call; compare tool output to expected."""
    expected = compute_expected_output()
    for _ in range(NUM_RUNS_TIMES):
        try:
            call = run_model_for_tool_call(system_prompt)
        except Exception as exc:
            print(f"Failed to parse tool call: {exc}")
            continue
        print(call)
        try:
            actual = execute_tool_call(call)
        except Exception as exc:
            print(f"Tool execution failed: {exc}")
            continue
        if actual.strip() == expected.strip():
            print(f"Generated tool call: {call}")
            print(f"Generated output: {actual}")
            print("SUCCESS")
            return True
        else:
            print("Expected output:\n" + expected)
            print("Actual output:\n" + actual)
    return False


if __name__ == "__main__":
    test_your_prompt(YOUR_SYSTEM_PROMPT)
