import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type Preview = {
  kind: "mesh" | "points";
  positions: number[];
  indices: number[];
  floor: number;
  ceiling: number;
};

export function SourceView({ projectId, sliceHeight }: { projectId: string; sliceHeight: number }) {
  const host = useRef<HTMLDivElement>(null);
  const plane = useRef<THREE.Mesh | null>(null);
  const floor = useRef(0);
  const height = useRef(sliceHeight);
  height.current = sliceHeight;

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let dead = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#1c1917");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    camera.position.set(8, 6, 8);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.AmbientLight("#fffaf3", 0.7));
    const sun = new THREE.DirectionalLight("#ffffff", 1.1);
    sun.position.set(4, 10, 6);
    scene.add(sun);
    const slice = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: "#f59e0b", transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    slice.rotation.x = -Math.PI / 2;
    scene.add(slice);
    plane.current = slice;

    const resize = () => {
      const width = Math.max(node.clientWidth, 10);
      const viewHeight = Math.max(node.clientHeight, 10);
      renderer.setSize(width, viewHeight, false);
      camera.aspect = width / viewHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    renderer.domElement.dataset.testid = "view-3d-canvas";
    node.appendChild(renderer.domElement);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    void fetch(`/api/projects/${projectId}/preview`)
      .then((response) => response.json())
      .then((preview: Preview) => {
        if (dead || !preview.positions?.length) return;
        floor.current = preview.floor ?? 0;
        const positions = new Float32Array(preview.positions.length);
        for (let index = 0; index < preview.positions.length; index += 3) {
          positions[index] = preview.positions[index];
          positions[index + 1] = preview.positions[index + 2];
          positions[index + 2] = -preview.positions[index + 1];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        if (preview.kind === "mesh" && preview.indices?.length) {
          geometry.setIndex(preview.indices);
          geometry.computeVertexNormals();
          scene.add(
            new THREE.Mesh(
              geometry,
              new THREE.MeshStandardMaterial({ color: "#d6d3d1", metalness: 0, roughness: 0.85, side: THREE.DoubleSide }),
            ),
          );
        } else {
          scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#e7e5e4", size: 0.045 })));
        }
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (bounds) {
          const size = bounds.getSize(new THREE.Vector3());
          const span = Math.max(size.x, size.y, size.z, 1);
          slice.scale.set(span * 1.4, span * 1.4, 1);
          controls.target.copy(bounds.getCenter(new THREE.Vector3()));
          camera.position.copy(controls.target).add(new THREE.Vector3(span * 1.1, span * 0.9, span * 1.1));
          controls.update();
        }
        slice.position.y = floor.current + height.current;
      })
      .catch(() => undefined);

    return () => {
      dead = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      plane.current = null;
      if (renderer.domElement.parentNode === node) node.removeChild(renderer.domElement);
    };
  }, [projectId]);

  useEffect(() => {
    if (plane.current) plane.current.position.y = floor.current + sliceHeight;
  }, [sliceHeight]);

  return <div ref={host} className="view3d" data-testid="view-3d" data-slice={sliceHeight.toFixed(2)} />;
}
