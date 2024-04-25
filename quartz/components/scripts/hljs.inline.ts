window.addEventListener("DOMContentLoaded", () => {
    var tree = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    
    while (tree.nextNode()) {
        var textNode = tree.currentNode;
        if (textNode != null && textNode.nodeValue != null) {
            textNode.nodeValue = textNode.nodeValue.replace(/\/\*@START_[A-Z_]+@\*\//g, '');
            textNode.nodeValue = textNode.nodeValue.replace(/\/\*@END_[A-Z_]+@\*\//g, '');
        }
    }
})