// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "Hanasand",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "Hanasand", targets: ["Hanasand"]),
    ],
    targets: [
        .executableTarget(
            name: "Hanasand",
            path: "Sources/Hanasand",
            resources: [.process("Resources")]
        ),
    ]
)
