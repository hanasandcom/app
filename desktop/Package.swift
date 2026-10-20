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
    dependencies: [
        .package(url: "https://github.com/apple/swift-certificates.git", exact: "1.21.0"),
        .package(url: "https://github.com/apple/swift-asn1.git", exact: "1.7.3"),
    ],
    targets: [
        .executableTarget(
            name: "Hanasand",
            dependencies: [
                .product(name: "X509", package: "swift-certificates"),
                .product(name: "SwiftASN1", package: "swift-asn1"),
            ],
            path: "Sources/Hanasand",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "HanasandTests",
            dependencies: ["Hanasand"],
            path: "Tests/HanasandTests"
        ),
    ]
)
