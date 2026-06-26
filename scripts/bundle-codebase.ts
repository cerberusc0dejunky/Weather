import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { fileURLToPath } from 'url';

// Configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'codebase_summary.txt');

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.gemini',
  'brain',
  '.next',
  'build',
  'coverage'
]);

const INCLUDED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.json'
]);

const IGNORED_FILES = new Set([
  'package-lock.json',
  'codebase_summary.txt'
]);

// 1. Directory Scanner
function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (IGNORED_DIRS.has(file)) continue;
      getFilesRecursively(filePath, fileList);
    } else {
      if (IGNORED_FILES.has(file)) continue;
      const ext = path.extname(file).toLowerCase();
      if (INCLUDED_EXTENSIONS.has(ext)) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

// 2. Directory Tree Generator
interface TreeNode {
  name: string;
  files: string[];
  dirs: { [key: string]: TreeNode };
}

function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: '.', files: [], dirs: {} };
  
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let current = root;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.dirs[part]) {
        current.dirs[part] = { name: part, files: [], dirs: {} };
      }
      current = current.dirs[part];
    }
    
    current.files.push(parts[parts.length - 1]);
  }
  
  return root;
}

function printTree(node: TreeNode, prefix: string = '', isLast: boolean = true): string {
  let result = '';
  
  if (node.name !== '.') {
    result += `${prefix}${isLast ? '└── ' : '├── '}${node.name}/\n`;
  }
  
  const newPrefix = node.name === '.' ? '' : prefix + (isLast ? '    ' : '│   ');
  
  const dirKeys = Object.keys(node.dirs).sort();
  const files = node.files.sort();
  
  // Print subdirectories
  for (let i = 0; i < dirKeys.length; i++) {
    const isChildLast = (i === dirKeys.length - 1) && (files.length === 0);
    result += printTree(node.dirs[dirKeys[i]], newPrefix, isChildLast);
  }
  
  // Print files
  for (let i = 0; i < files.length; i++) {
    const isChildLast = i === files.length - 1;
    result += `${newPrefix}${isChildLast ? '└── ' : '├── '}${files[i]}\n`;
  }
  
  return result;
}

function getTreeString(paths: string[]): string {
  const tree = buildTree(paths);
  return '.\n' + printTree(tree, '', true);
}

// 3. TypeScript Import Resolver Helper
function resolveImportPath(currentFilePath: string, importPath: string): string | null {
  if (!importPath.startsWith('.')) {
    return null; // External package
  }
  
  const currentDir = path.dirname(currentFilePath);
  const absolutePathWithoutExt = path.resolve(currentDir, importPath);
  
  const extensions = ['.tsx', '.ts', '.d.ts', '.js', '.jsx', '/index.tsx', '/index.ts', '/index.js'];
  for (const ext of extensions) {
    const fullPath = absolutePathWithoutExt + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }
  
  if (fs.existsSync(absolutePathWithoutExt) && fs.statSync(absolutePathWithoutExt).isFile()) {
    return absolutePathWithoutExt;
  }
  
  return null;
}

// 4. AST-based Call Hierarchy Extractor
interface FunctionDef {
  name: string;
  startLine: number;
  endLine: number;
  calls: string[];
}

interface ImportItem {
  localName: string;
  moduleSpecifier: string;
  resolvedPath: string | null;
}

interface FileAnalysis {
  filePath: string;
  relativeFilePath: string;
  imports: ImportItem[];
  functions: FunctionDef[];
  localFunctionNames: Set<string>;
}

function analyzeFile(filePath: string, relativePath: string): FileAnalysis {
  const content = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  
  const imports: ImportItem[] = [];
  const functions: FunctionDef[] = [];
  const localFunctionNames = new Set<string>();
  
  // Parse import declarations
  sourceFile.statements.forEach(statement => {
    if (ts.isImportDeclaration(statement)) {
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const moduleSpecifier = statement.moduleSpecifier.text;
        const resolvedPath = resolveImportPath(filePath, moduleSpecifier);
        
        const importClause = statement.importClause;
        if (importClause) {
          if (importClause.name) {
            imports.push({
              localName: importClause.name.text,
              moduleSpecifier,
              resolvedPath
            });
          }
          
          if (importClause.namedBindings) {
            const bindings = importClause.namedBindings;
            if (ts.isNamespaceImport(bindings)) {
              imports.push({
                localName: bindings.name.text,
                moduleSpecifier,
                resolvedPath
              });
            } else if (ts.isNamedImports(bindings)) {
              bindings.elements.forEach(element => {
                imports.push({
                  localName: element.name.text,
                  moduleSpecifier,
                  resolvedPath
                });
              });
            }
          }
        }
      }
    }
  });

  // Track function stack for nesting
  const functionStack: FunctionDef[] = [];
  const topLevelCalls: string[] = [];

  function getFunctionName(node: ts.Node): string | null {
    if (ts.isFunctionDeclaration(node)) {
      return node.name ? node.name.text : 'defaultExport';
    }
    if (ts.isMethodDeclaration(node)) {
      return node.name.getText();
    }
    if (ts.isConstructorDeclaration(node)) {
      return 'constructor';
    }
    if (ts.isGetAccessorDeclaration(node)) {
      return `get ${node.name.getText()}`;
    }
    if (ts.isSetAccessorDeclaration(node)) {
      return `set ${node.name.getText()}`;
    }
    
    // Assigned functions (arrow or expression)
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = node.parent;
      if (parent && ts.isVariableDeclaration(parent)) {
        return parent.name.getText();
      }
      if (parent && ts.isPropertyAssignment(parent)) {
        return parent.name.getText();
      }
    }
    return null;
  }

  function walk(node: ts.Node) {
    let pushed = false;
    const name = getFunctionName(node);
    
    if (name && (
      ts.isFunctionDeclaration(node) || 
      ts.isMethodDeclaration(node) || 
      ts.isConstructorDeclaration(node) || 
      ts.isGetAccessorDeclaration(node) || 
      ts.isSetAccessorDeclaration(node) || 
      ts.isArrowFunction(node) || 
      ts.isFunctionExpression(node)
    )) {
      const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      
      const newFunc: FunctionDef = {
        name,
        startLine: startLine + 1,
        endLine: endLine + 1,
        calls: []
      };
      
      functions.push(newFunc);
      functionStack.push(newFunc);
      localFunctionNames.add(name);
      pushed = true;
    }
    
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let callName = '';
      if (ts.isIdentifier(expr)) {
        callName = expr.text;
      } else if (ts.isPropertyAccessExpression(expr)) {
        callName = expr.getText();
      } else {
        callName = expr.getText();
      }
      
      if (callName) {
        if (functionStack.length > 0) {
          functionStack[functionStack.length - 1].calls.push(callName);
        } else {
          topLevelCalls.push(callName);
        }
      }
    }
    
    ts.forEachChild(node, walk);
    
    if (pushed) {
      functionStack.pop();
    }
  }

  walk(sourceFile);
  
  if (topLevelCalls.length > 0) {
    functions.unshift({
      name: '<top-level>',
      startLine: 1,
      endLine: content.split('\n').length,
      calls: topLevelCalls
    });
  }

  return {
    filePath,
    relativeFilePath: relativePath,
    imports,
    functions,
    localFunctionNames
  };
}

// 5. Call Hierarchy Resolution
interface ResolvedCall {
  name: string;
  type: 'local' | 'imported' | 'external';
  details?: string;
}

interface ResolvedFunction {
  name: string;
  startLine: number;
  endLine: number;
  calls: ResolvedCall[];
}

interface ResolvedFile {
  relativeFilePath: string;
  functions: ResolvedFunction[];
}

function resolveAllCalls(analyses: FileAnalysis[]): ResolvedFile[] {
  const resolvedFiles: ResolvedFile[] = [];

  for (const analysis of analyses) {
    const resolvedFunctions: ResolvedFunction[] = [];
    const importsMap = new Map<string, ImportItem>();
    
    for (const imp of analysis.imports) {
      importsMap.set(imp.localName, imp);
    }
    
    for (const fn of analysis.functions) {
      const resolvedCalls: ResolvedCall[] = [];
      const seenCalls = new Set<string>();
      
      for (const call of fn.calls) {
        if (seenCalls.has(call)) continue;
        seenCalls.add(call);
        
        const parts = call.split('.');
        const mainIdentifier = parts[0];
        
        if (analysis.localFunctionNames.has(mainIdentifier)) {
          resolvedCalls.push({
            name: call,
            type: 'local',
            details: 'Local function'
          });
        } else if (importsMap.has(mainIdentifier)) {
          const imp = importsMap.get(mainIdentifier)!;
          if (imp.resolvedPath) {
            const relPath = path.relative(PROJECT_ROOT, imp.resolvedPath).replace(/\\/g, '/');
            resolvedCalls.push({
              name: call,
              type: 'imported',
              details: `Imported from ${relPath}`
            });
          } else {
            resolvedCalls.push({
              name: call,
              type: 'imported',
              details: `Library/external import (${imp.moduleSpecifier})`
            });
          }
        } else {
          resolvedCalls.push({
            name: call,
            type: 'external'
          });
        }
      }
      
      resolvedFunctions.push({
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        calls: resolvedCalls
      });
    }
    
    resolvedFiles.push({
      relativeFilePath: analysis.relativeFilePath,
      functions: resolvedFunctions
    });
  }
  
  return resolvedFiles;
}

// Main Execution
function main() {
  console.log('Scanning files in:', PROJECT_ROOT);
  const absoluteFiles = getFilesRecursively(PROJECT_ROOT);
  const relativeFiles = absoluteFiles.map(f => path.relative(PROJECT_ROOT, f).replace(/\\/g, '/'));
  
  console.log(`Found ${relativeFiles.length} files to compile.`);
  
  // Generate Tree String
  const treeString = getTreeString(relativeFiles);
  
  // AST Call Hierarchy Analysis
  const analyses: FileAnalysis[] = [];
  for (const absFile of absoluteFiles) {
    const ext = path.extname(absFile).toLowerCase();
    if (ext === '.ts' || ext === '.tsx') {
      const relPath = path.relative(PROJECT_ROOT, absFile).replace(/\\/g, '/');
      try {
        const analysis = analyzeFile(absFile, relPath);
        analyses.push(analysis);
      } catch (err) {
        console.error(`Error analyzing file ${relPath}:`, err);
      }
    }
  }
  
  const resolvedFiles = resolveAllCalls(analyses);
  
  // Build the text bundle
  let outputText = '';
  outputText += `================================================================================\n`;
  outputText += `CODEBASE BUNDLE FOR NOTEBOOKLM\n`;
  outputText += `Generated: ${new Date().toISOString()}\n`;
  outputText += `Project Root: ${PROJECT_ROOT}\n`;
  outputText += `Total Files Compiled: ${relativeFiles.length}\n`;
  outputText += `================================================================================\n\n`;
  
  outputText += `================================================================================\n`;
  outputText += `DIRECTORY TREE STRUCTURE\n`;
  outputText += `================================================================================\n`;
  outputText += treeString;
  outputText += `\n\n`;
  
  outputText += `================================================================================\n`;
  outputText += `FUNCTION CALL HIERARCHY\n`;
  outputText += `================================================================================\n`;
  for (const file of resolvedFiles) {
    if (file.functions.length === 0) continue;
    
    outputText += `\n- File: ${file.relativeFilePath}\n`;
    for (const fn of file.functions) {
      outputText += `  - Function/Scope: ${fn.name} (Lines ${fn.startLine}-${fn.endLine})\n`;
      if (fn.calls.length === 0) {
        outputText += `    - (No call expressions detected)\n`;
      } else {
        for (const call of fn.calls) {
          if (call.type === 'local') {
            outputText += `    - Calls: ${call.name} (Local)\n`;
          } else if (call.type === 'imported') {
            outputText += `    - Calls: ${call.name} (${call.details})\n`;
          } else {
            outputText += `    - Calls: ${call.name} (External/Library)\n`;
          }
        }
      }
    }
  }
  outputText += `\n\n`;
  
  outputText += `================================================================================\n`;
  outputText += `CODEBASE SOURCE FILES\n`;
  outputText += `================================================================================\n\n`;
  
  for (const absFile of absoluteFiles) {
    const relPath = path.relative(PROJECT_ROOT, absFile).replace(/\\/g, '/');
    const content = fs.readFileSync(absFile, 'utf8');
    
    outputText += `================================================================================\n`;
    outputText += `FILE: ${relPath}\n`;
    outputText += `================================================================================\n`;
    outputText += content;
    outputText += `\n\n`;
  }
  
  fs.writeFileSync(OUTPUT_FILE, outputText, 'utf8');
  console.log(`Successfully compiled codebase to: ${OUTPUT_FILE}`);
}

main();
