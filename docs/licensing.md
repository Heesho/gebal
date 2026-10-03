# Licensing and dependency boundaries

Gebal's original code, agent instructions and original fixture are licensed under [MIT](../LICENSE). The repository is intended to be usable and adaptable by other developers. The source repository is published separately from any optional tool images or services. Package metadata remains `private: true` to prevent accidental npm publication; that does not restrict the MIT rights in the source.

Dependencies retain their own licenses. Reference repositories were consulted for concepts/interfaces only: no third-party skill, prompt pack, code, logo, marketing copy or benchmark report was imported. Exact revisions and observed root licenses are in references.md. 0xSimao's inspected root did not establish reuse permission; copying/adapting that material remains blocked. Trail of Bits skill content carries share-alike terms. OpenKritt and several analysis tools carry copyleft terms. Running a subprocess/container is not a license exemption.

`dependency-licenses.json` records the installed npm dependency inventory. Metadata does not replace required license text, notices or source availability obligations. Before shipping packages/images, review exact distributed dependency licenses and preserve required notices. The optional Docker recipe expects the operator to prepare separately licensed tools and dependencies; Gebal's MIT license does not relicense them.

Cloud API data handling and prover service/build terms are separate. A consumer AI subscription does not imply direct API credits. AutoProver's repository license alone does not establish permission or infrastructure availability for a hosted/local Certora prover. None of those services is provisioned or submitted to automatically.
