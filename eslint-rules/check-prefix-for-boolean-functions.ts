import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";
import ts from "typescript";

type FunctionNode =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

const CHECK_PREFIX = /^check[A-Z]/;

export const checkPrefixForBooleanFunctions = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: "suggestion",
    messages: {
      missingCheckPrefix: "`{{name}}` returns boolean, so name it `{{suggestion}}`",
    },
    schema: [],
    defaultOptions: [],
  },
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      FunctionDeclaration: (node) => {
        reportIfMisnamed(node.id, node);
      },
      VariableDeclarator: (node) => {
        if (checkIsFunctionNode(node.init)) reportIfMisnamed(node.id, node.init);
      },
      MethodDefinition: (node) => {
        if (node.kind === "method" && checkIsFunctionNode(node.value)) reportIfMisnamed(node.key, node.value);
      },
    };

    function reportIfMisnamed(nameNode: TSESTree.Node | null, fn: FunctionNode): void {
      if (nameNode?.type !== AST_NODE_TYPES.Identifier) return;
      if (CHECK_PREFIX.test(nameNode.name)) return;
      if (!checkReturnsBoolean(fn)) return;
      context.report({
        node: nameNode,
        messageId: "missingCheckPrefix",
        data: { name: nameNode.name, suggestion: suggestName(nameNode.name) },
      });
    }

    function checkReturnsBoolean(fn: FunctionNode): boolean {
      const signature = checker.getSignatureFromDeclaration(services.esTreeNodeToTSNodeMap.get(fn));
      if (!signature) return false;
      const returnType = checker.getReturnTypeOfSignature(signature);
      return checkIsBooleanType(checker.getAwaitedType(returnType) ?? returnType);
    }
  },
});

function checkIsFunctionNode(node: TSESTree.Node | null): node is FunctionNode {
  return node?.type === AST_NODE_TYPES.ArrowFunctionExpression || node?.type === AST_NODE_TYPES.FunctionExpression;
}

function checkIsBooleanType(type: ts.Type): boolean {
  const parts = type.isUnion() ? type.types : [type];
  return parts.every((part) => (part.flags & ts.TypeFlags.BooleanLike) !== 0);
}

function suggestName(name: string): string {
  return `check${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}
