const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
const CONTROLS_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";

export async function createViewer(container, messageElement) {
  const [three, controlsModule] = await Promise.all([
    import(THREE_URL),
    import(CONTROLS_URL)
  ]);
  const { OrbitControls } = controlsModule;
  const renderer = new three.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x111923);
  renderer.outputColorSpace = three.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new three.Scene();
  scene.background = new three.Color(0x111923);
  const camera = new three.PerspectiveCamera(42, 1, 0.1, 100000);
  camera.up.set(0, 0, 1);
  camera.position.set(260, -320, 250);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  const grid = new three.GridHelper(400, 40, 0x536879, 0x293b4a);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);
  const axes = new three.AxesHelper(80);
  scene.add(axes);
  scene.add(new three.AmbientLight(0xffffff, 1.3));
  const light = new three.DirectionalLight(0xffffff, 2.2);
  light.position.set(120, -180, 260);
  scene.add(light);

  const content = new three.Group();
  scene.add(content);
  const simulation = new three.Mesh(
    new three.SphereGeometry(3, 18, 12),
    new three.MeshStandardMaterial({ color: 0xffd166, emissive: 0x5c3000 })
  );
  simulation.visible = false;
  scene.add(simulation);

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function clearContent() {
    for (const child of [...content.children]) {
      child.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
          else object.material.dispose();
        }
      });
      content.remove(child);
    }
  }

  function fit(points) {
    if (!points.length) {
      controls.target.set(0, 0, 0);
      camera.position.set(260, -320, 250);
      grid.scale.setScalar(1);
      axes.scale.setScalar(1);
      camera.near = 0.1;
      camera.far = 100000;
      camera.updateProjectionMatrix();
      controls.update();
      return 200;
    }
    const bounds = new three.Box3();
    points.forEach(point => bounds.expandByPoint(new three.Vector3(point.x, point.y, point.z)));
    const center = bounds.getCenter(new three.Vector3());
    const size = bounds.getSize(new three.Vector3());
    const radius = Math.max(size.length() * 0.65, 20);
    grid.scale.setScalar(Math.max(1, radius / 200));
    axes.scale.setScalar(Math.max(1, radius / 200));
    controls.target.copy(center);
    camera.position.copy(center).add(new three.Vector3(radius, -radius * 1.35, radius));
    camera.near = Math.max(0.1, radius / 1000);
    camera.far = Math.max(10000, radius * 30);
    camera.updateProjectionMatrix();
    controls.update();
    return radius;
  }

  function update(originalPoints, pathPoints, options = {}) {
    clearContent();
    const pathSegments = Array.isArray(options.pathSegments) ? options.pathSegments : [pathPoints];
    const allPoints = [...originalPoints, ...pathPoints];
    if (originalPoints.length) {
      const sphere = new three.SphereGeometry(1, 16, 12);
      const material = new three.MeshStandardMaterial({ color: 0xffb456, roughness: 0.55 });
      originalPoints.forEach(point => {
        const marker = new three.Mesh(sphere, material);
        marker.position.set(point.x, point.y, point.z);
        marker.scale.setScalar(Math.max(1, options.markerSize || 2));
        content.add(marker);
      });
    }
    pathSegments.forEach(segment => {
      if (segment.length < 2) return;
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.Float32BufferAttribute(
        segment.flatMap(point => [point.x, point.y, point.z]), 3));
      content.add(new three.Line(geometry, new three.LineBasicMaterial({ color: 0x52d3b2, linewidth: 2 })));
    });
    if (options.showOutput && pathPoints.length) {
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.Float32BufferAttribute(
        pathPoints.flatMap(point => [point.x, point.y, point.z]), 3));
      content.add(new three.Points(geometry, new three.PointsMaterial({ color: 0x62c9ff, size: 2.4, sizeAttenuation: true })));
    }
    if (pathPoints.length) {
      const vertices = [];
      const stride = Math.max(1, Math.floor(pathPoints.length / 24));
      for (let i = 0; i < pathPoints.length; i += stride) {
        const point = pathPoints[i];
        const direction = options.getToolDirection(point.c, point.a);
        const length = options.arrowLength || 10;
        vertices.push(point.x, point.y, point.z,
          point.x + direction.x * length, point.y + direction.y * length, point.z + direction.z * length);
      }
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.Float32BufferAttribute(vertices, 3));
      content.add(new three.LineSegments(geometry, new three.LineBasicMaterial({ color: 0xff6e91 })));
    }
    simulation.visible = false;
    fit(allPoints);
    if (messageElement) {
      messageElement.textContent = pathPoints.length
        ? "Fare: döndür · Tekerlek: yakınlaştır · Sağ tuş: kaydır"
        : "Noktalar eklendikçe yol burada görünür.";
    }
  }

  function setSimulation(point) {
    if (!point) {
      simulation.visible = false;
      return;
    }
    simulation.position.set(point.x, point.y, point.z);
    simulation.visible = true;
  }

  function reset() { fit([]); }

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    update,
    setSimulation,
    reset,
    dispose() {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      controls.dispose();
      container.removeChild(renderer.domElement);
    }
  };
}
