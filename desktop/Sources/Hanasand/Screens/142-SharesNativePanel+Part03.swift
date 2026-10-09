import AppKit
import ApplicationServices
import Combine
import CryptoKit
import Darwin
import Foundation
import Network
import PDFKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

extension SharesNativePanel {

    func treePreview(_ items: [DashboardShareTreeItem], depth: Int = 0) -> String {
        items.prefix(10).map { item in
            let marker = item.type == "folder" ? ">" : "-"
            let line = "\(String(repeating: "  ", count: depth))\(marker) \(item.name)"
            guard let children = item.children, !children.isEmpty else { return line }
            return line + "\n" + treePreview(children, depth: depth + 1)
        }.joined(separator: "\n")
    }
}
